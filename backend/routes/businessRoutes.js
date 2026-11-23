/* =========================================
   ZEBRA DOMUS INN
   The business: sales, expenses, money in, balances, the overview and the report.
   Mounted at /api/admin/business

   GET   /sales                 ?from &to          sales in the period         (sales.record or money.view)
   GET   /sales/items                              what can be sold, with selling prices      (sales.record)
   POST  /sales                 { day?, lines: [{ itemId?, name?, quantity, price }],
                                  paidWith: cash|momo|airtel|card|bank|credit,
                                  customerName?, phone?, dueDay?, note? }            (sales.record)
                                stock items go out of the store ("Sold"); a line with a name and
                                no item is a meal or a service (no stock). Paid now: money in.
                                On credit: a debt is opened for the customer.
   POST  /sales/:id/cancel      { reason }  the items go back, the money or the debt is taken back (sales.cancel)

   GET   /expenses              ?from &to                                   (expenses.record or money.view)
   POST  /expenses              { day?, category, amount, paidWith, paidTo?, note? }   (expenses.record)
   POST  /expenses/:id/cancel   { reason }                                             (expenses.cancel)

   GET   /money-in              ?from &to          every payment received                      (money.view)
   POST  /money-in              { day?, amount, paidWith, description, customerName? }
                                other money in (not a booking, event, sale or debt)         (money.view)
   POST  /money-in/:id/cancel   { reason }  only money in added by hand                     (money.view)

   GET   /balances              starting balances and what each account holds now           (money.view)
   PUT   /balances              { day, cash, momo, airtel, bank }  the starting balances    (money.view)

   GET   /overview              today and this month, balances, debts, stock value          (money.view)
   GET   /report                ?from &to  profit or loss, money in and out, balances       (money.view)

   Profit or loss:
     income = rooms and events paid + sales made + other money in
     costs  = cost of the items sold + stock used by the departments + stock written off
              and missing at counts + expenses + credit sales forgiven
   Purchases are not a cost when bought: the stock is still the inn's until it is used or sold.
========================================= */

const express = require("express");
const mongoose = require("mongoose");

const Sale = require("../models/Sale");
const Expense = require("../models/Expense");
const { EXPENSE_CATEGORIES } = Expense;
const MoneyIn = require("../models/MoneyIn");
const OpeningBalance = require("../models/OpeningBalance");
const Purchase = require("../models/Purchase");
const StockItem = require("../models/StockItem");
const StockMovement = require("../models/StockMovement");
const Debt = require("../models/Debt");
const { can, requirePermission, requireAny } = require("../utils/permissions");
const { parseDay, toDay, addDays, innToday } = require("../utils/availability");
const { audit } = require("../utils/audit");
const { MAX_AMOUNT, round, amount, money, text, qtyText, nextRef, changeStock } = require("../utils/stockOps");
const { wholeNumberProblem } = require("../utils/units");
const { phoneKey } = require("../utils/limits");
const { METHODS, METHOD_NAMES, ACCOUNTS, accountOf, recordMoneyIn, voidMoneyIn } = require("../utils/money");

const router = express.Router();

const MAX_LINES = 30;
const MAX_MONEY = 100000000;
const DAYS_BACK = 366;
const LIST_LIMIT = 500;
const SOLD = "Sold"; // the stock change "out" for a sale goes to this instead of a department

function bad(res, message, status = 400) {
  return res.status(status).json({ success: false, message });
}

function serverError(res, label, error) {
  console.error(`${label}:`, error.message);
  return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
}

function rwf(value) {
  return `RWF ${Math.round(Number(value) || 0).toLocaleString("en-US")}`;
}

function sum(list, pick) {
  return list.reduce((total, x) => total + (Number(pick(x)) || 0), 0);
}

function byKey(list, keyOf, valueOf) {
  const out = {};
  list.forEach((x) => {
    const key = keyOf(x);
    out[key] = (out[key] || 0) + (Number(valueOf(x)) || 0);
  });
  return out;
}

function emptyAccounts() {
  return ACCOUNTS.reduce((out, a) => ({ ...out, [a]: 0 }), {});
}

// "YYYY-MM-DD" not in the future and at most a year back (default today); null if wrong
function recentDay(value) {
  const today = innToday();
  const dayText = value === undefined || value === null || value === "" ? today : value;
  const day = parseDay(dayText);
  if (!day || dayText > today) return null;
  if (day < addDays(parseDay(today), -DAYS_BACK)) return null;
  return day;
}

// the period asked for (default: this month so far)
function period(query) {
  const today = innToday();
  const fromText = parseDay(query.from) ? query.from : `${today.slice(0, 8)}01`;
  const toText = parseDay(query.to) ? query.to : today;
  if (toText < fromText) return { error: "The end date can't be before the start date." };
  return { fromText, toText, from: parseDay(fromText), to: parseDay(toText) };
}

// moments (not days) inside the Rwanda days of a period
function momentsOf(fromText, toText) {
  return { $gte: new Date(`${fromText}T00:00:00+02:00`), $lt: new Date(new Date(`${toText}T00:00:00+02:00`).getTime() + 86400000) };
}

/* ---------- Shown to the dashboard ---------- */

function saleForAdmin(sale, money) {
  const shown = {
    _id: sale._id,
    ref: sale.ref,
    day: toDay(sale.day),
    lines: sale.lines.map((l) => ({ itemId: l.item || null, itemName: l.itemName, unit: l.unit, quantity: l.quantity, price: l.price })),
    total: sale.total,
    paidWith: sale.paidWith,
    customerName: sale.customerName,
    phone: sale.phone,
    note: sale.note,
    debtId: sale.debt || null,
    status: sale.status,
    soldByName: sale.soldByName,
    createdAt: sale.createdAt,
    cancelledByName: sale.cancelledByName,
    reason: sale.reason,
  };
  if (money) {
    shown.cost = sale.cost;
    shown.profit = sale.total - sale.cost;
  }
  return shown;
}

function expenseForAdmin(x) {
  return {
    _id: x._id,
    ref: x.ref,
    day: toDay(x.day),
    category: x.category,
    amount: x.amount,
    paidWith: x.method,
    paidTo: x.paidTo,
    note: x.note,
    status: x.status,
    createdByName: x.createdByName,
    createdAt: x.createdAt,
    cancelledByName: x.cancelledByName,
    reason: x.reason,
  };
}

function moneyInForAdmin(m) {
  return {
    _id: m._id,
    ref: m.ref,
    day: toDay(m.day),
    amount: m.amount,
    paidWith: m.method,
    account: m.account,
    source: m.source,
    sourceRef: m.sourceRef,
    income: m.income,
    description: m.description,
    customerName: m.customerName,
    note: m.note,
    status: m.status,
    voidReason: m.voidReason,
    voidedByName: m.voidedByName,
    createdByName: m.createdByName,
    createdAt: m.createdAt,
  };
}

/* ---------- Sales ---------- */

router.get("/sales/items", requirePermission("sales.record"), async (req, res) => {
  try {
    const items = await StockItem.find({ active: { $ne: false } }).sort({ category: 1, name: 1 }).lean();
    return res.json({
      success: true,
      items: items.map((item) => ({
        _id: item._id,
        name: item.name,
        category: item.category,
        unit: item.unit,
        quantity: item.quantity,
        salePrice: item.salePrice === undefined ? null : item.salePrice,
      })),
    });
  } catch (error) {
    return serverError(res, "Sale items failed", error);
  }
});

router.get("/sales", requireAny("sales.record", "money.view"), async (req, res) => {
  try {
    const p = period(req.query);
    if (p.error) return bad(res, p.error);
    const seesMoney = can(req.admin, "money.view");
    const sales = await Sale.find({ day: { $gte: p.from, $lte: p.to } }).sort({ day: -1, createdAt: -1 }).limit(LIST_LIMIT).lean();
    const done = sales.filter((s) => s.status === "done");

    const totals = {
      count: done.length,
      total: sum(done, (s) => s.total),
      onCredit: sum(done.filter((s) => s.paidWith === "credit"), (s) => s.total),
      byMethod: byKey(done, (s) => s.paidWith, (s) => s.total),
    };
    if (seesMoney) {
      totals.cost = sum(done, (s) => s.cost);
      totals.profit = totals.total - totals.cost;
    }

    // what sold most (by money)
    const lines = new Map();
    done.forEach((s) => s.lines.forEach((l) => {
      const key = l.item ? String(l.item) : `name:${l.itemName.toLowerCase()}`;
      const row = lines.get(key) || { itemName: l.itemName, unit: l.unit, quantity: 0, total: 0 };
      row.quantity = round(row.quantity + l.quantity);
      row.total += l.quantity * l.price;
      lines.set(key, row);
    }));

    return res.json({
      success: true,
      from: p.fromText,
      to: p.toText,
      totals,
      top: [...lines.values()].sort((a, b) => b.total - a.total).slice(0, 10).map((r) => ({ ...r, total: Math.round(r.total) })),
      sales: sales.map((s) => saleForAdmin(s, seesMoney)),
    });
  } catch (error) {
    return serverError(res, "Sales list failed", error);
  }
});

router.post("/sales", requirePermission("sales.record"), async (req, res) => {
  try {
    const body = req.body || {};
    const day = recentDay(body.day);
    if (!day) return bad(res, "The sale day can't be in the future (or more than a year ago).");

    const paidWith = body.paidWith;
    if (!METHODS.includes(paidWith) && paidWith !== "credit") return bad(res, "Choose how they paid, or \"On credit\".");

    const customerName = text(body.customerName).slice(0, 80);
    const phone = text(body.phone).slice(0, 30);
    const note = text(body.note).slice(0, 200);
    if (paidWith === "credit" && customerName.length < 2) return bad(res, "On credit: write the customer's name, so the debt is theirs.");
    if (phone && phoneKey(phone).length < 9) return bad(res, "The phone number looks too short.");
    let dueDay = null;
    if (paidWith === "credit" && body.dueDay) {
      dueDay = parseDay(body.dueDay);
      if (!dueDay || dueDay < day) return bad(res, "The day they will pay can't be before the sale.");
    }

    if (!Array.isArray(body.lines) || !body.lines.length) return bad(res, "Add at least one thing sold.");
    if (body.lines.length > MAX_LINES) return bad(res, `A sale can have up to ${MAX_LINES} lines.`);

    // check everything before taking anything out of the store
    const lines = [];
    const seen = new Set();
    for (const raw of body.lines) {
      const line = raw || {};
      const quantity = amount(line.quantity, 0.01, MAX_AMOUNT);
      const price = money(line.price);

      if (line.itemId) {
        if (!mongoose.isValidObjectId(line.itemId)) return bad(res, "One of the items wasn't found. Reload the page.", 404);
        const item = await StockItem.findById(line.itemId).lean();
        if (!item || item.active === false) return bad(res, "One of the items wasn't found. Reload the page.", 404);
        if (seen.has(String(item._id))) return bad(res, `${item.name} is listed twice. Put it on one line.`);
        seen.add(String(item._id));
        if (quantity === null) return bad(res, `Write how many ${item.unit} of ${item.name} were sold.`);
        const whole = wholeNumberProblem(item.name, item.unit, quantity);
        if (whole) return bad(res, whole);
        if (quantity > item.quantity) return bad(res, `Only ${qtyText(item.quantity)} ${item.unit} of ${item.name} ${item.quantity === 1 ? "is" : "are"} in the store.`, 409);
        if (price === null || price < 1) return bad(res, `Write the price for one ${item.name} (a whole number of RWF).`);
        lines.push({ item: item._id, itemName: item.name, unit: item.unit, quantity, price, unitCost: item.unitCost || 0 });
      } else {
        const name = text(line.name).slice(0, 80);
        if (name.length < 2) return bad(res, "Choose an item, or write what was sold (a meal or a service).");
        if (quantity === null) return bad(res, `Write how many ${name} were sold.`);
        if (price === null || price < 1) return bad(res, `Write the price for one ${name} (a whole number of RWF).`);
        lines.push({ itemName: name, unit: "", quantity, price, unitCost: 0 });
      }
    }

    const total = Math.round(sum(lines, (l) => l.quantity * l.price));
    if (total > MAX_MONEY) return bad(res, "That total is too big. Check the amounts.");
    const ref = await nextRef("S");

    // take the items out of the store; if one can't go (or the sale can't be saved),
    // put back the ones already taken, so the store never loses items without a sale
    const done = [];
    async function putBack() {
      for (const back of done) {
        await changeStock({
          itemId: back.item, type: "out", quantity: back.quantity, change: back.quantity,
          person: req.admin, day, note: `Sale ${ref} not completed`, department: SOLD, ref,
        });
      }
    }
    for (const line of lines.filter((l) => l.item)) {
      const result = await changeStock({
        itemId: line.item, type: "out", quantity: line.quantity, change: -line.quantity,
        person: req.admin, day, note: `Sale ${ref}`, department: SOLD, ref,
      });
      if (result.error) {
        await putBack();
        return bad(res, result.error, result.status || 409);
      }
      line.unitCost = result.before.unitCost || 0;
      done.push(line);
    }

    const cost = Math.round(sum(lines, (l) => l.quantity * l.unitCost));
    let sale;
    try {
      sale = await Sale.create({
        ref, day, lines, total, cost, paidWith, customerName, phone, note,
        soldBy: req.admin._id, soldByName: req.admin.name,
      });
    } catch (error) {
      await putBack();
      throw error;
    }

    const words = lines.map((l) => `${qtyText(l.quantity)} × ${l.itemName}`).join(", ");
    let said = `Sold ${ref}: ${words} for ${rwf(total)}`;

    if (paidWith === "credit") {
      const debt = await Debt.create({
        ref: await nextRef("D"),
        customerName,
        phone,
        phoneKey: phone ? phoneKey(phone) : "",
        kind: "restaurant",
        description: words.slice(0, 200),
        sale: sale._id,
        linkedRef: ref,
        amount: total,
        day,
        dueDay,
        note,
        createdBy: req.admin._id,
        createdByName: req.admin.name,
      });
      await Sale.updateOne({ _id: sale._id }, { $set: { debt: debt._id } });
      sale.debt = debt._id;
      said += `, on credit to ${customerName} (debt ${debt.ref})`;
      await audit(req.admin, "debts", `Recorded debt ${debt.ref}: ${customerName} owes ${rwf(total)} for sale ${ref}`);
    } else {
      await recordMoneyIn({
        person: req.admin, amount: total, day, method: paidWith, source: "sale",
        sourceId: sale._id, sourceRef: ref, income: "", // the sale itself is the income
        description: `Sale ${ref}: ${words}`.slice(0, 200), customerName,
      });
      said += ` (${METHOD_NAMES[paidWith]})`;
    }
    await audit(req.admin, "sales", said);

    return res.status(201).json({ success: true, sale: saleForAdmin(sale.toObject(), can(req.admin, "money.view")) });
  } catch (error) {
    return serverError(res, "Recording a sale failed", error);
  }
});

router.post("/sales/:id/cancel", requirePermission("sales.cancel"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "That sale wasn't found.", 404);
    const sale = await Sale.findById(req.params.id).lean();
    if (!sale) return bad(res, "That sale wasn't found.", 404);
    if (sale.status !== "done") return bad(res, "This sale is already cancelled.");
    const reason = text((req.body || {}).reason).slice(0, 200);
    if (reason.length < 3) return bad(res, "Write why the sale is cancelled.");

    let debt = null;
    if (sale.debt) {
      debt = await Debt.findById(sale.debt).lean();
      if (debt && debt.paid > 0) return bad(res, `${sale.customerName} already paid ${rwf(debt.paid)} on debt ${debt.ref}, so the sale can't be cancelled.`);
    }

    const updated = await Sale.findOneAndUpdate(
      { _id: sale._id, status: "done" },
      { $set: { status: "cancelled", reason, cancelledByName: req.admin.name, cancelledAt: new Date() } },
      { returnDocument: "after" }
    ).lean();
    if (!updated) return bad(res, "Someone else just changed this sale. Refresh and try again.", 409);

    // the items go back into the store
    const day = parseDay(innToday());
    for (const line of sale.lines.filter((l) => l.item)) {
      await changeStock({
        itemId: line.item, type: "out", quantity: line.quantity, change: line.quantity,
        person: req.admin, day, note: `Sale ${sale.ref} cancelled: back in the store`, department: SOLD, ref: sale.ref,
      });
    }

    let said = `Cancelled sale ${sale.ref} (${rwf(sale.total)}): ${reason}`;
    const taken = await voidMoneyIn({ source: "sale", sourceId: sale._id }, req.admin, `Sale cancelled: ${reason}`);
    if (taken.length) said += `; money in ${taken.map((e) => e.ref).join(", ")} taken back`;
    if (debt && debt.status === "open") {
      await Debt.updateOne({ _id: debt._id, status: "open" }, { $set: { status: "cancelled", reason: `Sale ${sale.ref} cancelled`, closedAt: new Date(), closedByName: req.admin.name } });
      said += `; debt ${debt.ref} cancelled`;
    }
    await audit(req.admin, "sales", said);

    return res.json({ success: true, sale: saleForAdmin(updated, can(req.admin, "money.view")) });
  } catch (error) {
    return serverError(res, "Cancelling a sale failed", error);
  }
});

/* ---------- Expenses ---------- */

router.get("/expenses", requireAny("expenses.record", "money.view"), async (req, res) => {
  try {
    const p = period(req.query);
    if (p.error) return bad(res, p.error);
    const expenses = await Expense.find({ day: { $gte: p.from, $lte: p.to } }).sort({ day: -1, createdAt: -1 }).limit(LIST_LIMIT).lean();
    const done = expenses.filter((x) => x.status === "done");
    return res.json({
      success: true,
      from: p.fromText,
      to: p.toText,
      categories: EXPENSE_CATEGORIES,
      totals: {
        count: done.length,
        total: sum(done, (x) => x.amount),
        byCategory: byKey(done, (x) => x.category, (x) => x.amount),
        byAccount: byKey(done, (x) => x.account, (x) => x.amount),
      },
      expenses: expenses.map(expenseForAdmin),
    });
  } catch (error) {
    return serverError(res, "Expenses list failed", error);
  }
});

router.post("/expenses", requirePermission("expenses.record"), async (req, res) => {
  try {
    const body = req.body || {};
    const day = recentDay(body.day);
    if (!day) return bad(res, "The day can't be in the future (or more than a year ago).");
    if (!EXPENSE_CATEGORIES.includes(body.category)) return bad(res, "Choose what the money was for.");
    const paid = money(body.amount);
    if (!paid || paid < 1 || paid > MAX_MONEY) return bad(res, "Write how much was paid, in RWF (a whole number).");
    if (!METHODS.includes(body.paidWith)) return bad(res, "Choose how it was paid.");
    const paidTo = text(body.paidTo).slice(0, 80);
    const note = text(body.note).slice(0, 300);
    if (body.category === "Other" && !paidTo && !note) return bad(res, "For \"Other\", write who was paid or what it was for.");

    const expense = await Expense.create({
      ref: await nextRef("X"),
      day,
      category: body.category,
      amount: paid,
      method: body.paidWith,
      account: accountOf(body.paidWith),
      paidTo,
      note,
      createdBy: req.admin._id,
      createdByName: req.admin.name,
    });
    await audit(req.admin, "expenses", `Expense ${expense.ref}: ${rwf(paid)} for ${expense.category}` + (paidTo ? ` to ${paidTo}` : "") + ` (${METHOD_NAMES[expense.method]})`);
    return res.status(201).json({ success: true, expense: expenseForAdmin(expense.toObject()) });
  } catch (error) {
    return serverError(res, "Recording an expense failed", error);
  }
});

router.post("/expenses/:id/cancel", requirePermission("expenses.cancel"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "That expense wasn't found.", 404);
    const reason = text((req.body || {}).reason).slice(0, 200);
    if (reason.length < 3) return bad(res, "Write why the expense is cancelled.");
    const updated = await Expense.findOneAndUpdate(
      { _id: req.params.id, status: "done" },
      { $set: { status: "cancelled", reason, cancelledByName: req.admin.name, cancelledAt: new Date() } },
      { returnDocument: "after" }
    ).lean();
    if (!updated) return bad(res, "That expense wasn't found, or it is already cancelled.", 404);
    await audit(req.admin, "expenses", `Cancelled expense ${updated.ref} (${rwf(updated.amount)}, ${updated.category}): ${reason}`);
    return res.json({ success: true, expense: expenseForAdmin(updated) });
  } catch (error) {
    return serverError(res, "Cancelling an expense failed", error);
  }
});

/* ---------- Money in ---------- */

router.get("/money-in", requirePermission("money.view"), async (req, res) => {
  try {
    const p = period(req.query);
    if (p.error) return bad(res, p.error);
    const entries = await MoneyIn.find({ day: { $gte: p.from, $lte: p.to } }).sort({ day: -1, createdAt: -1 }).limit(LIST_LIMIT).lean();
    const active = entries.filter((m) => m.status === "active");
    return res.json({
      success: true,
      from: p.fromText,
      to: p.toText,
      totals: {
        count: active.length,
        total: sum(active, (m) => m.amount),
        byAccount: { ...emptyAccounts(), ...byKey(active, (m) => m.account, (m) => m.amount) },
        bySource: byKey(active, (m) => m.source, (m) => m.amount),
      },
      entries: entries.map(moneyInForAdmin),
    });
  } catch (error) {
    return serverError(res, "Money in list failed", error);
  }
});

router.post("/money-in", requirePermission("money.view"), async (req, res) => {
  try {
    const body = req.body || {};
    const day = recentDay(body.day);
    if (!day) return bad(res, "The day can't be in the future (or more than a year ago).");
    const got = money(body.amount);
    if (!got || got < 1 || got > MAX_MONEY) return bad(res, "Write how much came in, in RWF (a whole number).");
    if (!METHODS.includes(body.paidWith)) return bad(res, "Choose how it was paid.");
    const description = text(body.description).slice(0, 200);
    if (description.length < 3) return bad(res, "Write what the money is for.");
    const entry = await recordMoneyIn({
      person: req.admin, amount: got, day, method: body.paidWith, source: "other", income: "other",
      description, customerName: text(body.customerName).slice(0, 80), note: text(body.note).slice(0, 200),
    });
    await audit(req.admin, "money", `Money in ${entry.ref}: ${rwf(got)} for ${description} (${METHOD_NAMES[entry.method]})`);
    return res.status(201).json({ success: true, entry: moneyInForAdmin(entry.toObject()) });
  } catch (error) {
    return serverError(res, "Recording money in failed", error);
  }
});

router.post("/money-in/:id/cancel", requirePermission("money.view"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "That entry wasn't found.", 404);
    const entry = await MoneyIn.findById(req.params.id).lean();
    if (!entry || entry.status !== "active") return bad(res, "That entry wasn't found, or it is already cancelled.", 404);
    if (entry.source !== "other") {
      return bad(res, `This money came from ${entry.source === "debt" ? "a debt payment" : `a ${entry.source}`} (${entry.sourceRef}). Change it there instead.`);
    }
    const reason = text((req.body || {}).reason).slice(0, 200);
    if (reason.length < 3) return bad(res, "Write why it is cancelled.");
    await voidMoneyIn({ _id: entry._id }, req.admin, reason);
    await audit(req.admin, "money", `Cancelled money in ${entry.ref} (${rwf(entry.amount)}, ${entry.description}): ${reason}`);
    return res.json({ success: true });
  } catch (error) {
    return serverError(res, "Cancelling money in failed", error);
  }
});

/* ---------- Balances: what each account holds ---------- */

async function latestOpening() {
  return OpeningBalance.findOne().sort({ createdAt: -1, _id: -1 }).lean();
}

// what each account holds at the end of a day: the starting balances, plus money in, less money out since then
async function balancesAt(dayText, opening) {
  const end = parseDay(dayText);
  const start = opening ? opening.day : new Date(0);
  const range = { $gte: start, $lte: end };
  const [ins, expenses, purchases] = await Promise.all([
    MoneyIn.find({ status: "active", day: range }).select("amount account").lean(),
    Expense.find({ status: "done", day: range }).select("amount account").lean(),
    Purchase.find({ status: { $ne: "cancelled" }, day: range }).select("total paidWith").lean(),
  ]);
  const inBy = byKey(ins, (m) => m.account, (m) => m.amount);
  const outBy = byKey(expenses, (x) => x.account, (x) => x.amount);
  purchases.forEach((pu) => {
    const account = accountOf(pu.paidWith || "cash");
    outBy[account] = (outBy[account] || 0) + pu.total;
  });
  const accounts = ACCOUNTS.map((account) => {
    const startWith = opening ? opening[account] || 0 : 0;
    const moneyIn = Math.round(inBy[account] || 0);
    const moneyOut = Math.round(outBy[account] || 0);
    return { account, start: startWith, moneyIn, moneyOut, balance: startWith + moneyIn - moneyOut };
  });
  return {
    since: opening ? toDay(opening.day) : "",
    accounts,
    total: sum(accounts, (a) => a.balance),
  };
}

router.get("/balances", requirePermission("money.view"), async (req, res) => {
  try {
    const opening = await latestOpening();
    return res.json({
      success: true,
      opening: opening ? { day: toDay(opening.day), cash: opening.cash, momo: opening.momo, airtel: opening.airtel, bank: opening.bank, setByName: opening.setByName, setAt: opening.createdAt } : null,
      now: await balancesAt(innToday(), opening),
    });
  } catch (error) {
    return serverError(res, "Balances failed", error);
  }
});

router.put("/balances", requirePermission("money.view"), async (req, res) => {
  try {
    const body = req.body || {};
    const day = recentDay(body.day);
    if (!day) return bad(res, "Choose the day of the starting balances (today or before).");
    const values = {};
    for (const account of ACCOUNTS) {
      const value = body[account] === undefined || body[account] === "" ? 0 : money(body[account]);
      if (value === null || value > MAX_MONEY) return bad(res, "Each balance must be a whole number of RWF, 0 or more.");
      values[account] = value;
    }
    const opening = await OpeningBalance.create({ day, ...values, setByName: req.admin.name });
    await audit(req.admin, "money",
      `Set the starting balances on ${toDay(day)}: cash ${rwf(values.cash)}, MTN MoMo ${rwf(values.momo)}, Airtel Money ${rwf(values.airtel)}, bank ${rwf(values.bank)}`);
    return res.json({ success: true, now: await balancesAt(innToday(), opening.toObject()) });
  } catch (error) {
    return serverError(res, "Setting balances failed", error);
  }
});

/* ---------- Profit or loss for a period ---------- */

async function figuresFor(fromText, toText) {
  const from = parseDay(fromText);
  const to = parseDay(toText);
  const days = { $gte: from, $lte: to };

  const [ins, expenses, purchases, sales, moves, items, forgiven] = await Promise.all([
    MoneyIn.find({ status: "active", day: days }).select("amount account source income").lean(),
    Expense.find({ status: "done", day: days }).select("amount account category").lean(),
    Purchase.find({ status: { $ne: "cancelled" }, day: days }).select("total paidWith").lean(),
    Sale.find({ status: "done", day: days }).select("total cost paidWith").lean(),
    StockMovement.find({ day: days, type: { $in: ["out", "loss", "count"] } }).select("item type change unitCost department").lean(),
    StockItem.find().select("unitCost").lean(),
    Debt.find({ status: "forgiven", sale: { $ne: null }, closedAt: momentsOf(fromText, toText) }).select("forgiven").lean(),
  ]);

  const costOf = new Map(items.map((i) => [String(i._id), i.unitCost || 0]));
  const valueOf = (m) => m.change * (m.unitCost !== undefined && m.unitCost !== null ? m.unitCost : costOf.get(String(m.item)) || 0);

  const income = {
    rooms: Math.round(sum(ins.filter((m) => m.income === "rooms"), (m) => m.amount)),
    events: Math.round(sum(ins.filter((m) => m.income === "events"), (m) => m.amount)),
    sales: Math.round(sum(sales, (s) => s.total) + sum(ins.filter((m) => m.income === "sales"), (m) => m.amount)),
    other: Math.round(sum(ins.filter((m) => m.income === "other"), (m) => m.amount)),
  };
  income.total = income.rooms + income.events + income.sales + income.other;

  const expensesByCategory = byKey(expenses, (x) => x.category, (x) => x.amount);
  const costs = {
    sold: Math.round(-sum(moves.filter((m) => m.type === "out" && m.department === SOLD), valueOf)),
    used: Math.round(-sum(moves.filter((m) => m.type === "out" && m.department !== SOLD), valueOf)),
    writtenOff: Math.round(-sum(moves.filter((m) => m.type === "loss"), valueOf)),
    countDifferences: Math.round(-sum(moves.filter((m) => m.type === "count"), valueOf)), // missing = a cost, found = less cost
    expenses: Math.round(sum(expenses, (x) => x.amount)),
    forgiven: Math.round(sum(forgiven, (d) => d.forgiven)),
  };
  costs.total = costs.sold + costs.used + costs.writtenOff + costs.countDifferences + costs.expenses + costs.forgiven;

  const moneyInByAccount = { ...emptyAccounts(), ...byKey(ins, (m) => m.account, (m) => m.amount) };
  const moneyOutByAccount = { ...emptyAccounts(), ...byKey(expenses, (x) => x.account, (x) => x.amount) };
  purchases.forEach((pu) => {
    const account = accountOf(pu.paidWith || "cash");
    moneyOutByAccount[account] += pu.total;
  });

  return {
    from: fromText,
    to: toText,
    income,
    costs,
    profit: income.total - costs.total,
    expensesByCategory,
    sales: { count: sales.length, total: Math.round(sum(sales, (s) => s.total)), cost: Math.round(sum(sales, (s) => s.cost)), onCredit: Math.round(sum(sales.filter((s) => s.paidWith === "credit"), (s) => s.total)) },
    moneyIn: {
      total: Math.round(sum(ins, (m) => m.amount)),
      byAccount: moneyInByAccount,
      bySource: byKey(ins, (m) => m.source, (m) => m.amount),
    },
    moneyOut: {
      total: Math.round(sum(expenses, (x) => x.amount) + sum(purchases, (pu) => pu.total)),
      expenses: costs.expenses,
      purchases: Math.round(sum(purchases, (pu) => pu.total)),
      byAccount: moneyOutByAccount,
    },
  };
}

async function debtsNow() {
  const open = await Debt.find({ status: "open" }).select("amount paid forgiven customerName phoneKey").lean();
  return {
    owed: Math.round(sum(open, (d) => d.amount - d.paid - d.forgiven)),
    count: open.length,
    customers: new Set(open.map((d) => d.phoneKey || d.customerName.toLowerCase())).size,
  };
}

async function stockValueNow() {
  const items = await StockItem.find({ active: { $ne: false } }).select("quantity unitCost").lean();
  return Math.round(sum(items, (i) => i.quantity * (i.unitCost || 0)));
}

router.get("/report", requirePermission("money.view"), async (req, res) => {
  try {
    const p = period(req.query);
    if (p.error) return bad(res, p.error);

    // the period before, of the same length
    const length = Math.round((p.to - p.from) / 86400000) + 1;
    const beforeTo = toDay(addDays(p.from, -1));
    const beforeFrom = toDay(addDays(p.from, -length));

    const opening = await latestOpening();
    const [figures, before, balances, debts, stockValue] = await Promise.all([
      figuresFor(p.fromText, p.toText),
      figuresFor(beforeFrom, beforeTo),
      balancesAt(p.toText, opening),
      debtsNow(),
      stockValueNow(),
    ]);

    return res.json({
      success: true,
      ...figures,
      before: { from: before.from, to: before.to, income: before.income.total, costs: before.costs.total, profit: before.profit, moneyIn: before.moneyIn.total, moneyOut: before.moneyOut.total },
      balances,
      openingSet: Boolean(opening),
      debts,
      stockValue,
    });
  } catch (error) {
    return serverError(res, "Business report failed", error);
  }
});

/* ---------- Overview: today, this month, and right now ---------- */

router.get("/overview", requirePermission("money.view"), async (req, res) => {
  try {
    const today = innToday();
    const monthStart = `${today.slice(0, 8)}01`;
    const opening = await latestOpening();

    const [todayFigures, month, balances, debts, stockValue, recentIn, recentOut, recentSales, recentPurchases] = await Promise.all([
      figuresFor(today, today),
      figuresFor(monthStart, today),
      balancesAt(today, opening),
      debtsNow(),
      stockValueNow(),
      MoneyIn.find({ status: "active" }).sort({ createdAt: -1 }).limit(8).lean(),
      Expense.find({ status: "done" }).sort({ createdAt: -1 }).limit(8).lean(),
      Sale.find({ status: "done", paidWith: "credit" }).sort({ createdAt: -1 }).limit(8).lean(),
      Purchase.find({ status: { $ne: "cancelled" } }).sort({ createdAt: -1 }).limit(8).lean(),
    ]);

    // the latest money movements, newest first
    const recent = []
      .concat(recentIn.map((m) => ({ at: m.createdAt, day: toDay(m.day), direction: "in", amount: m.amount, what: m.description || m.sourceRef, how: m.method, ref: m.ref })))
      .concat(recentOut.map((x) => ({ at: x.createdAt, day: toDay(x.day), direction: "out", amount: x.amount, what: x.category + (x.paidTo ? ` (${x.paidTo})` : ""), how: x.method, ref: x.ref })))
      .concat(recentPurchases.map((pu) => ({ at: pu.createdAt, day: toDay(pu.day), direction: "out", amount: pu.total, what: `Purchase from ${pu.supplier}`, how: pu.paidWith || "cash", ref: pu.ref })))
      .concat(recentSales.map((s) => ({ at: s.createdAt, day: toDay(s.day), direction: "credit", amount: s.total, what: `Sale on credit to ${s.customerName}`, how: "credit", ref: s.ref })))
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 10);

    return res.json({
      success: true,
      today,
      todayFigures: { moneyIn: todayFigures.moneyIn.total, moneyOut: todayFigures.moneyOut.total, sales: todayFigures.sales, profit: todayFigures.profit },
      month: { from: monthStart, to: today, moneyIn: month.moneyIn.total, moneyOut: month.moneyOut.total, income: month.income, costs: month.costs, profit: month.profit, sales: month.sales },
      balances,
      openingSet: Boolean(opening),
      debts,
      stockValue,
      recent,
    });
  } catch (error) {
    return serverError(res, "Business overview failed", error);
  }
});

module.exports = router;
