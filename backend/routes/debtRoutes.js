/* =========================================
   ZEBRA DOMUS INN
   Debts: customers who owe the inn money. Mounted at /api/admin/debts

   GET   /                ?show=open|overdue|paid|closed|all &q=name or phone
                          the debts, and totals for everything still owed      (debts.view)
   POST  /                { customerName, phone?, kind, description?, amount,
                            day?, dueDay?, note?, bookingId? | eventId? }      (debts.manage)
   PATCH /:id             { customerName?, phone?, description?, amount?, dueDay?, note? }
                                                                               (debts.manage)
   POST  /:id/payments    { amount, method, day?, note? }  part or all of it   (debts.manage)
   POST  /:id/forgive     { reason }  write off what is left                   (debts.forgive)
   POST  /:id/cancel      { reason }  recorded by mistake, no payments yet     (debts.forgive)

   When a debt for a booking or an event is paid in full, the booking or event
   is marked paid too. Every change goes in the audit log.
========================================= */

const express = require("express");
const mongoose = require("mongoose");

const Debt = require("../models/Debt");
const { PAYMENT_METHODS, DEBT_KINDS } = Debt;
const Booking = require("../models/Booking");
const EventBooking = require("../models/EventBooking");
const { requirePermission } = require("../utils/permissions");
const { parseDay, toDay, innToday } = require("../utils/availability");
const { audit } = require("../utils/audit");
const { money, text, nextRef } = require("../utils/stockOps");
const { phoneKey } = require("../utils/limits");
const { recordMoneyIn } = require("../utils/money");

const router = express.Router();

const MAX_DEBT = 100000000;
const LIST_LIMIT = 300;

const METHOD_NAMES = { cash: "cash", momo: "MTN MoMo", airtel: "Airtel Money", card: "card", bank: "bank transfer" };
const KIND_NAMES = { room: "a room booking", event: "an event", restaurant: "the restaurant or bar", other: "other" };

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

function left(debt) {
  return Math.max(0, debt.amount - debt.paid - debt.forgiven);
}

function dayWords(date) {
  return date ? new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isOverdue(debt, today) {
  return debt.status === "open" && debt.dueDay && toDay(debt.dueDay) < today;
}

function debtForAdmin(debt, today) {
  return {
    _id: debt._id,
    ref: debt.ref,
    customerName: debt.customerName,
    phone: debt.phone,
    kind: debt.kind,
    description: debt.description,
    linkedRef: debt.linkedRef,
    saleId: debt.sale || null,
    bookingId: debt.booking || null,
    eventId: debt.event || null,
    amount: debt.amount,
    paid: debt.paid,
    forgiven: debt.forgiven,
    left: left(debt),
    day: toDay(debt.day),
    dueDay: debt.dueDay ? toDay(debt.dueDay) : "",
    overdue: Boolean(isOverdue(debt, today)),
    note: debt.note,
    status: debt.status,
    reason: debt.reason,
    createdByName: debt.createdByName,
    closedByName: debt.closedByName,
    closedAt: debt.closedAt || null,
    createdAt: debt.createdAt,
    payments: (debt.payments || []).map((p) => ({
      _id: p._id,
      amount: p.amount,
      day: toDay(p.day),
      method: p.method,
      note: p.note,
      receivedByName: p.receivedByName,
      createdAt: p.createdAt,
    })),
  };
}

// a day that is not in the future, or today when none is given (null if wrong)
function pastDay(value) {
  const today = innToday();
  if (value === undefined || value === null || value === "") return parseDay(today);
  const day = parseDay(value);
  if (!day || toDay(day) > today) return null;
  return day;
}

// the customer's details, checked; returns { error } or the clean values
function readCustomer(body, partial) {
  const out = {};
  if (!partial || body.customerName !== undefined) {
    const name = text(body.customerName).slice(0, 80);
    if (name.length < 2) return { error: "Write the customer's name." };
    out.customerName = name;
  }
  if (!partial || body.phone !== undefined) {
    const phone = text(body.phone).slice(0, 30);
    if (phone && phoneKey(phone).length < 9) return { error: "The phone number looks too short." };
    out.phone = phone;
    out.phoneKey = phone ? phoneKey(phone) : "";
  }
  if (!partial || body.description !== undefined) out.description = text(body.description).slice(0, 200);
  if (!partial || body.note !== undefined) out.note = text(body.note).slice(0, 300);
  return out;
}

/* ---------- The list, and what is owed in total ---------- */

router.get("/", requirePermission("debts.view"), async (req, res) => {
  try {
    const today = innToday();
    const todayDate = parseDay(today);
    const show = ["open", "overdue", "paid", "closed", "all"].includes(req.query.show) ? req.query.show : "open";

    const filter = {};
    if (show === "open") filter.status = "open";
    if (show === "overdue") Object.assign(filter, { status: "open", dueDay: { $ne: null, $lt: todayDate } });
    if (show === "paid") filter.status = "paid";
    if (show === "closed") filter.status = { $in: ["forgiven", "cancelled"] };

    const search = text(req.query.q).slice(0, 60);
    if (search) {
      const or = [{ customerName: new RegExp(escapeRegex(search), "i") }, { ref: new RegExp(escapeRegex(search), "i") }, { linkedRef: new RegExp(escapeRegex(search), "i") }];
      // phone digits as typed: "0788 123", "+250 788 123" or "788123" all find 0788123456
      const digits = search.replace(/\D/g, "").replace(/^(250|0)/, "");
      if (digits.length >= 4) or.push({ phoneKey: new RegExp(escapeRegex(digits.slice(-9))) });
      filter.$or = or;
    }

    const sort = show === "open" || show === "overdue" ? { dueDay: 1, day: 1, _id: 1 } : { updatedAt: -1, _id: -1 };
    const [debts, open] = await Promise.all([
      Debt.find(filter).sort(sort).limit(LIST_LIMIT).lean(),
      Debt.find({ status: "open" }).select("customerName phoneKey amount paid forgiven dueDay status").lean(),
    ]);

    // open debts: overdue ones first, then the ones with a promised day, then the rest
    if (show === "open") {
      const rank = (d) => (isOverdue(d, today) ? 0 : d.dueDay ? 1 : 2);
      debts.sort((a, b) => rank(a) - rank(b));
    }

    // totals for everything still owed, whatever the filter
    const customers = new Set(open.map((d) => d.phoneKey || d.customerName.toLowerCase()));
    const overdue = open.filter((d) => isOverdue(d, today));
    const monthStart = parseDay(`${today.slice(0, 8)}01`);
    const [paidThisMonth] = await Debt.aggregate([
      { $unwind: "$payments" },
      { $match: { "payments.day": { $gte: monthStart } } },
      { $group: { _id: null, total: { $sum: "$payments.amount" }, count: { $sum: 1 } } },
    ]);

    return res.json({
      success: true,
      show,
      today,
      summary: {
        owed: open.reduce((sum, d) => sum + left(d), 0),
        openCount: open.length,
        customers: customers.size,
        overdueCount: overdue.length,
        overdueOwed: overdue.reduce((sum, d) => sum + left(d), 0),
        paidThisMonth: paidThisMonth ? paidThisMonth.total : 0,
        paymentsThisMonth: paidThisMonth ? paidThisMonth.count : 0,
      },
      debts: debts.map((d) => debtForAdmin(d, today)),
    });
  } catch (error) {
    return serverError(res, "Debts list failed", error);
  }
});

/* ---------- Record a debt ---------- */

router.post("/", requirePermission("debts.manage"), async (req, res) => {
  try {
    const body = req.body || {};
    const customer = readCustomer(body, false);
    if (customer.error) return bad(res, customer.error);

    const kind = DEBT_KINDS.includes(body.kind) ? body.kind : "other";
    const owed = money(body.amount);
    if (!owed || owed < 1 || owed > MAX_DEBT) return bad(res, "Write how much they owe, in RWF (a whole number).");

    const day = pastDay(body.day);
    if (!day) return bad(res, "The date the debt started can't be in the future.");

    let dueDay = null;
    if (body.dueDay) {
      dueDay = parseDay(body.dueDay);
      if (!dueDay || dueDay < day) return bad(res, "The day they will pay can't be before the debt started.");
    }

    const debt = { ...customer, kind, amount: owed, day, dueDay };

    // linked to a booking or an event: one open debt each
    if (body.bookingId) {
      if (!mongoose.isValidObjectId(body.bookingId)) return bad(res, "That booking wasn't found.", 404);
      const booking = await Booking.findById(body.bookingId).lean();
      if (!booking) return bad(res, "That booking wasn't found.", 404);
      if (booking.bookingStatus === "cancelled") return bad(res, "That booking was cancelled.");
      if (await Debt.exists({ booking: booking._id, status: "open" })) return bad(res, `There is already an open debt for booking ${booking.bookingReference}.`, 409);
      Object.assign(debt, { kind: "room", booking: booking._id, linkedRef: booking.bookingReference });
    } else if (body.eventId) {
      if (!mongoose.isValidObjectId(body.eventId)) return bad(res, "That event wasn't found.", 404);
      const event = await EventBooking.findById(body.eventId).lean();
      if (!event) return bad(res, "That event wasn't found.", 404);
      if (["declined", "cancelled"].includes(event.status)) return bad(res, "That event was turned down or cancelled.");
      if (await Debt.exists({ event: event._id, status: "open" })) return bad(res, `There is already an open debt for event ${event.ref}.`, 409);
      Object.assign(debt, { kind: "event", event: event._id, linkedRef: event.ref });
    }

    const created = await Debt.create({
      ...debt,
      ref: await nextRef("D"),
      createdBy: req.admin._id,
      createdByName: req.admin.name,
    });

    await audit(req.admin, "debts",
      `Recorded debt ${created.ref}: ${created.customerName} owes ${rwf(created.amount)} for ` +
      (created.linkedRef ? `${created.kind === "event" ? "event" : "booking"} ${created.linkedRef}` : KIND_NAMES[created.kind]) +
      (created.dueDay ? `, to pay by ${dayWords(created.dueDay)}` : ""));

    return res.status(201).json({ success: true, debt: debtForAdmin(created.toObject(), innToday()) });
  } catch (error) {
    return serverError(res, "Recording a debt failed", error);
  }
});

/* ---------- Change the details ---------- */

router.patch("/:id", requirePermission("debts.manage"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "That debt wasn't found.", 404);
    const debt = await Debt.findById(req.params.id);
    if (!debt) return bad(res, "That debt wasn't found.", 404);
    if (debt.status !== "open") return bad(res, "Only a debt that is still open can be changed.");

    const body = req.body || {};
    const changes = readCustomer(body, true);
    if (changes.error) return bad(res, changes.error);

    if (body.amount !== undefined && debt.sale && Number(body.amount) !== debt.amount) {
      return bad(res, `The amount comes from sale ${debt.linkedRef} and can't be changed here.`);
    }
    if (body.amount !== undefined && !debt.sale) {
      const owed = money(body.amount);
      if (!owed || owed > MAX_DEBT) return bad(res, "Write how much they owe, in RWF (a whole number).");
      if (owed <= debt.paid + debt.forgiven) return bad(res, `They have already paid ${rwf(debt.paid)}. The amount must be more than that, or record a payment instead.`);
      changes.amount = owed;
    }
    if (body.dueDay !== undefined) {
      if (body.dueDay === "" || body.dueDay === null) changes.dueDay = null;
      else {
        const dueDay = parseDay(body.dueDay);
        if (!dueDay || dueDay < debt.day) return bad(res, "The day they will pay can't be before the debt started.");
        changes.dueDay = dueDay;
      }
    }

    const said = [];
    if (changes.customerName !== undefined && changes.customerName !== debt.customerName) said.push(`name ${debt.customerName} → ${changes.customerName}`);
    if (changes.phone !== undefined && changes.phone !== debt.phone) said.push(`phone ${debt.phone || "none"} → ${changes.phone || "none"}`);
    if (changes.amount !== undefined && changes.amount !== debt.amount) said.push(`amount ${rwf(debt.amount)} → ${rwf(changes.amount)}`);
    if (changes.dueDay !== undefined && String(changes.dueDay) !== String(debt.dueDay)) said.push(`pay by ${dayWords(debt.dueDay) || "no day"} → ${dayWords(changes.dueDay) || "no day"}`);
    if (changes.description !== undefined && changes.description !== debt.description) said.push("what it is for");
    if (changes.note !== undefined && changes.note !== debt.note) said.push("note");

    Object.assign(debt, changes);
    await debt.save();
    if (said.length) await audit(req.admin, "debts", `Changed debt ${debt.ref} (${debt.customerName}): ${said.join(", ")}`);

    return res.json({ success: true, debt: debtForAdmin(debt.toObject(), innToday()) });
  } catch (error) {
    return serverError(res, "Changing a debt failed", error);
  }
});

/* ---------- A payment: part or all of what is left ---------- */

router.post("/:id/payments", requirePermission("debts.manage"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "That debt wasn't found.", 404);
    const debt = await Debt.findById(req.params.id).lean();
    if (!debt) return bad(res, "That debt wasn't found.", 404);
    if (debt.status !== "open") return bad(res, "This debt is already closed.");

    const body = req.body || {};
    const paying = money(body.amount);
    const still = left(debt);
    if (!paying || paying < 1) return bad(res, "Write how much they paid, in RWF (a whole number).");
    if (paying > still) return bad(res, `They only owe ${rwf(still)}. Write ${rwf(still)} or less.`);
    if (!PAYMENT_METHODS.includes(body.method)) return bad(res, "Choose how they paid.");
    const day = pastDay(body.day);
    if (!day) return bad(res, "The payment date can't be in the future.");
    if (day < debt.day) return bad(res, "The payment date can't be before the debt started.");

    const fullyPaid = paying === still;
    const payment = {
      amount: paying,
      day,
      method: body.method,
      note: text(body.note).slice(0, 200),
      receivedBy: req.admin._id,
      receivedByName: req.admin.name,
    };

    // only if nobody else recorded a payment at the same moment
    const update = { $push: { payments: payment }, $inc: { paid: paying } };
    if (fullyPaid) update.$set = { status: "paid", closedAt: new Date(), closedByName: req.admin.name };
    const updated = await Debt.findOneAndUpdate({ _id: debt._id, status: "open", paid: debt.paid }, update, { returnDocument: "after" }).lean();
    if (!updated) return bad(res, "Someone else just recorded a payment on this debt. Refresh and try again.", 409);

    await recordMoneyIn({
      person: req.admin,
      amount: paying,
      day,
      method: payment.method,
      source: "debt",
      sourceId: updated._id,
      sourceRef: updated.ref,
      // a sale on credit is income when sold; rooms and events count when the money comes
      income: updated.sale ? "" : { room: "rooms", event: "events", restaurant: "sales", other: "other" }[updated.kind] || "other",
      description: `Debt ${updated.ref}` + (updated.linkedRef ? ` (${updated.linkedRef})` : ""),
      customerName: updated.customerName,
      note: payment.note,
    });

    let alsoMarked = "";
    if (fullyPaid && updated.booking) {
      const done = await Booking.updateOne({ _id: updated.booking, paymentStatus: { $ne: "paid" } }, { $set: { paymentStatus: "paid" } });
      if (done.modifiedCount) alsoMarked = `; booking ${updated.linkedRef} marked paid`;
    }
    if (fullyPaid && updated.event) {
      const done = await EventBooking.updateOne({ _id: updated.event, paid: { $ne: true } }, { $set: { paid: true } });
      if (done.modifiedCount) alsoMarked = `; event ${updated.linkedRef} marked paid`;
    }

    await audit(req.admin, "debts",
      `Payment ${rwf(paying)} on ${updated.ref} from ${updated.customerName} (${METHOD_NAMES[payment.method]}), ` +
      (fullyPaid ? "now fully paid" : `${rwf(left(updated))} left`) + alsoMarked);

    return res.json({ success: true, debt: debtForAdmin(updated, innToday()), fullyPaid });
  } catch (error) {
    return serverError(res, "Recording a payment failed", error);
  }
});

/* ---------- The owner closes a debt without full payment ---------- */

async function closeDebt(req, res, how) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "That debt wasn't found.", 404);
    const debt = await Debt.findById(req.params.id).lean();
    if (!debt) return bad(res, "That debt wasn't found.", 404);
    if (debt.status !== "open") return bad(res, "This debt is already closed.");

    const reason = text((req.body || {}).reason).slice(0, 200);
    if (reason.length < 3) return bad(res, how === "forgiven" ? "Write why the rest is forgiven." : "Write why this debt is cancelled.");
    if (how === "cancelled" && debt.paid > 0) return bad(res, `They already paid ${rwf(debt.paid)}, so it can't be cancelled. Forgive what is left instead.`);
    if (how === "cancelled" && debt.sale) return bad(res, `This debt is for sale ${debt.linkedRef}. Cancel the sale instead (in Business, Sales): the items go back into the store.`);

    const still = left(debt);
    const set = { status: how, reason, closedAt: new Date(), closedByName: req.admin.name };
    if (how === "forgiven") set.forgiven = debt.forgiven + still;

    const updated = await Debt.findOneAndUpdate({ _id: debt._id, status: "open", paid: debt.paid }, { $set: set }, { returnDocument: "after" }).lean();
    if (!updated) return bad(res, "Someone else just changed this debt. Refresh and try again.", 409);

    await audit(req.admin, "debts", how === "forgiven"
      ? `Forgave ${rwf(still)} left on ${updated.ref} (${updated.customerName}): ${reason}`
      : `Cancelled debt ${updated.ref} (${updated.customerName}, ${rwf(updated.amount)}): ${reason}`);

    return res.json({ success: true, debt: debtForAdmin(updated, innToday()) });
  } catch (error) {
    return serverError(res, "Closing a debt failed", error);
  }
}

router.post("/:id/forgive", requirePermission("debts.forgive"), (req, res) => closeDebt(req, res, "forgiven"));
router.post("/:id/cancel", requirePermission("debts.forgive"), (req, res) => closeDebt(req, res, "cancelled"));

module.exports = router;
