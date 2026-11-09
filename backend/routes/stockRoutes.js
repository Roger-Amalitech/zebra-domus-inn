/* =========================================
   ZEBRA DORMUS INN
   Stock (store room), mounted at /api/admin/stock

   GET   /items                  items with in stock / used / remaining     (stock.view)
   GET   /catalog                item names and what is left, to ask for supplies
   POST  /items                  add an item                                 (stock.items)
   POST  /items/starter          add a list of common inn items              (stock.items)
   PATCH /items/:id              change name, unit, warning level, archive   (stock.items)
   DELETE /items/:id             delete an item and its history              (stock.delete)
   POST  /items/remove-unused    delete items never counted, used or received (stock.delete)
   POST  /items/:id/movements    { type: out|count, quantity, department?, note?, day? }
                                 out = issue to a department (stock.issue)
                                 count (stock.count): the owner's count changes the stock at
                                 once; a manager's difference waits for the owner's approval
   GET   /counts                 counts waiting for approval (?status=all for every count)
   POST  /counts/:id/approve     the owner accepts a count difference        (stock.approve)
   POST  /counts/:id/reject      { reason }                                  (stock.approve)
   GET   /movements              ?itemId &before  latest changes             (stock.view)
   GET   /report                 ?from=YYYY-MM-DD|all &to=YYYY-MM-DD         (stock.view)
                                 the owner also gets money: values, spending, departments
   GET   /budget                 ?month=YYYY-MM  budget and spending per category (budget.manage)
   PUT   /budget                 { month, amounts: { category: RWF } }       (budget.manage)

   New stock comes in through purchases (purchaseRoutes.js) and goes
   out through issues and staff requests (requestRoutes.js).
   Prices and values are only shown to the owner (stock.prices).
========================================= */

const express = require("express");
const mongoose = require("mongoose");

const StockItem = require("../models/StockItem");
const StockMovement = require("../models/StockMovement");
const StockCount = require("../models/StockCount");
const Purchase = require("../models/Purchase");
const SupplyRequest = require("../models/SupplyRequest");
const Budget = require("../models/Budget");
const { can, requirePermission, requireAny, denied } = require("../utils/permissions");
const { parseDay, toDay, addDays, innToday } = require("../utils/availability");
const { DEPARTMENTS } = require("../utils/departments");
const { audit } = require("../utils/audit");
const { validMonth, monthOverview } = require("../utils/budget");
const { MAX_AMOUNT, round, amount, money, text, kigaliDay, qtyText, changeStock } = require("../utils/stockOps");

const { STOCK_CATEGORIES } = StockItem;
const DAYS_BACK = 60;

const router = express.Router();

/* ---------- Helpers ---------- */

function bad(res, message, status = 400) {
  return res.status(status).json({ success: false, message });
}

function serverError(res, label, error) {
  console.error(`${label}:`, error.message);
  return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
}

// prices and the value of the stock are only for the owner
function seesPrices(req) {
  return can(req.admin, "stock.prices");
}

function statusOf(item) {
  if (item.quantity <= 0) return "out";
  if (item.quantity <= item.lowStockAt) return "low";
  return "ok";
}

/* In stock, used and corrections since each item was added.
   Starting stock and purchases count as "in stock", so for every item:
   remaining now = in stock - used + corrections. */
async function totalsFor(itemIds) {
  const match = itemIds ? [{ $match: { item: { $in: itemIds } } }] : [];
  const rows = await StockMovement.aggregate([
    ...match,
    {
      $group: {
        _id: "$item",
        changes: { $sum: 1 },
        received: { $sum: { $cond: [{ $eq: ["$type", "in"] }, "$change", 0] } },
        used: { $sum: { $cond: [{ $eq: ["$type", "out"] }, { $multiply: ["$change", -1] }, 0] } },
        corrections: { $sum: { $cond: [{ $eq: ["$type", "count"] }, "$change", 0] } },
      },
    },
  ]);

  return new Map(rows.map((row) => [String(row._id), row]));
}

const NO_TOTALS = { changes: 0, received: 0, used: 0, corrections: 0 };

async function totalsOf(itemId) {
  return (await totalsFor([itemId])).get(String(itemId)) || NO_TOTALS;
}

function countForAdmin(count) {
  return {
    _id: count._id,
    itemId: count.item,
    itemName: count.itemName,
    unit: count.unit,
    recorded: count.recorded,
    counted: count.counted,
    change: count.change,
    note: count.note || "",
    day: toDay(count.day),
    status: count.status,
    countedByName: count.countedByName,
    decidedByName: count.decidedByName || "",
    decidedAt: count.decidedAt || null,
    reason: count.reason || "",
    createdAt: count.createdAt,
  };
}

function itemForAdmin(item, prices, totals, waitingCount) {
  const shown = {
    _id: item._id,
    name: item.name,
    category: item.category,
    unit: item.unit,
    quantity: item.quantity,
    lowStockAt: item.lowStockAt,
    notes: item.notes || "",
    active: item.active !== false,
    status: statusOf(item),
    updatedAt: item.updatedAt,
  };

  // since the item was added: how many times it was counted, used or
  // received (0 = never touched), and the amounts
  if (totals) {
    shown.changes = totals.changes;
    shown.received = round(totals.received);
    shown.used = round(totals.used);
    shown.corrections = round(totals.corrections);
  }

  // a count that waits for the owner's approval
  shown.waitingCount = waitingCount ? countForAdmin(waitingCount) : null;

  if (prices) {
    shown.unitCost = item.unitCost || 0;
    shown.value = round((item.unitCost || 0) * item.quantity);
  }

  return shown;
}

function movementForAdmin(move, prices) {
  const shown = {
    _id: move._id,
    itemId: move.item,
    itemName: move.itemName,
    type: move.type,
    quantity: move.quantity,
    change: move.change,
    balanceAfter: move.balanceAfter,
    note: move.note || "",
    department: move.department || "",
    ref: move.ref || "",
    day: toDay(move.day),
    userName: move.userName || "",
    createdAt: move.createdAt,
  };

  if (prices && move.unitCost !== undefined) shown.unitCost = move.unitCost;

  return shown;
}

/* The day a change happened: today, or up to 60 days back. */
function readDay(body) {
  const todayText = innToday();
  const dayText = text(body.day) || todayText;
  const day = parseDay(dayText);

  if (!day) return { error: "Please choose the day." };
  if (dayText > todayText) return { error: "The day can't be in the future." };
  if (day < addDays(parseDay(todayText), -DAYS_BACK)) return { error: `The day can be up to ${DAYS_BACK} days ago.` };

  return { day, dayText };
}

/* Reads the item fields sent by someone who manages items. */
function readItem(body, partial) {
  const values = {};
  const has = (key) => body[key] !== undefined;

  if (!partial || has("name")) {
    values.name = text(body.name);
    if (!values.name || values.name.length > 80) return { error: "Please enter the item's name (up to 80 characters)." };
  }

  if (!partial || has("category")) {
    values.category = text(body.category) || "Other";
    if (!STOCK_CATEGORIES.includes(values.category)) return { error: "Please choose a category." };
  }

  if (!partial || has("unit")) {
    values.unit = text(body.unit) || "pieces";
    if (values.unit.length > 20) return { error: "The unit can be up to 20 characters, for example \"rolls\"." };
  }

  if (has("lowStockAt") || !partial) {
    values.lowStockAt = has("lowStockAt") ? amount(body.lowStockAt, 0, MAX_AMOUNT) : 0;
    if (values.lowStockAt === null) return { error: "\"Warn me at\" must be a number, 0 or more." };
  }

  if (has("unitCost") || !partial) {
    values.unitCost = has("unitCost") && body.unitCost !== "" ? money(body.unitCost) : 0;
    if (values.unitCost === null) return { error: "The price must be a whole number of RWF." };
  }

  if (has("notes")) {
    if (typeof body.notes !== "string" || body.notes.length > 300) return { error: "Notes can be up to 300 characters." };
    values.notes = body.notes.trim();
  }

  if (has("active")) {
    if (typeof body.active !== "boolean") return { error: "Active must be yes or no." };
    values.active = body.active;
  }

  return { values };
}

/* ---------- Items ---------- */

router.get("/items", requirePermission("stock.view"), async (req, res) => {
  try {
    const filter = req.query.archived === "1" ? {} : { active: true };
    const [items, totals, waiting] = await Promise.all([
      StockItem.find(filter).sort({ category: 1, name: 1 }).lean(),
      totalsFor(null),
      StockCount.find({ status: "waiting" }).lean(),
    ]);
    const prices = seesPrices(req);
    const waitingOf = new Map(waiting.map((count) => [String(count.item), count]));
    const active = items.filter((item) => item.active !== false);

    const summary = {
      items: active.length,
      low: active.filter((item) => statusOf(item) === "low").length,
      out: active.filter((item) => statusOf(item) === "out").length,
      countsWaiting: waiting.length,
    };

    if (prices) summary.value = round(active.reduce((sum, item) => sum + (item.unitCost || 0) * item.quantity, 0));
    if (can(req.admin, "requests.manage")) summary.requestsWaiting = await SupplyRequest.countDocuments({ status: "waiting" });
    if (can(req.admin, "purchases.view")) summary.purchasesWaiting = await Purchase.countDocuments({ status: "waiting" });

    return res.json({
      success: true,
      categories: STOCK_CATEGORIES,
      departments: DEPARTMENTS,
      summary,
      items: items.map((item) =>
        itemForAdmin(item, prices, totals.get(String(item._id)) || NO_TOTALS, waitingOf.get(String(item._id)))
      ),
    });
  } catch (error) {
    return serverError(res, "Stock list failed", error);
  }
});

/* What staff choose from when they ask for supplies. */
router.get("/catalog", requireAny("requests.make", "stock.view"), async (req, res) => {
  try {
    const items = await StockItem.find({ active: true }).sort({ category: 1, name: 1 }).lean();

    return res.json({
      success: true,
      departments: DEPARTMENTS,
      items: items.map((item) => ({
        _id: item._id,
        name: item.name,
        category: item.category,
        unit: item.unit,
        quantity: item.quantity,
        status: statusOf(item),
      })),
    });
  } catch (error) {
    return serverError(res, "Stock catalog failed", error);
  }
});

async function createItem(values, quantity, req) {
  const item = await StockItem.create({ ...values, nameKey: values.name.toLowerCase(), quantity });

  if (quantity > 0) {
    await StockMovement.create({
      item: item._id,
      itemName: item.name,
      type: "in",
      quantity,
      change: quantity,
      balanceAfter: quantity,
      unitCost: values.unitCost || undefined,
      note: "Starting stock",
      day: parseDay(innToday()),
      userId: req.admin._id,
      userName: req.admin.name,
    });
  }

  return item;
}

router.post("/items", requirePermission("stock.items"), async (req, res) => {
  try {
    const body = req.body || {};
    const { values, error } = readItem(body, false);
    if (error) return bad(res, error);
    if (!seesPrices(req)) values.unitCost = 0;

    const quantity = body.quantity === undefined || body.quantity === "" ? 0 : amount(body.quantity, 0, MAX_AMOUNT);
    if (quantity === null) return bad(res, "The starting quantity must be a number, 0 or more.");

    // stock that appears without a purchase is the owner's call
    if (quantity > 0 && !can(req.admin, "stock.approve")) {
      return denied(res, "Only the owner can enter a starting quantity. Add the item, then count it; the owner approves the number.");
    }

    if (await StockItem.exists({ nameKey: values.name.toLowerCase() })) {
      return bad(res, `There is already an item called "${values.name}".`, 409);
    }

    const item = await createItem(values, quantity, req);
    await audit(req.admin, "stock", `Added item ${item.name}` + (quantity > 0 ? ` with ${qtyText(quantity)} ${item.unit} starting stock` : ""));

    const totals = quantity > 0 ? { changes: 1, received: quantity, used: 0, corrections: 0 } : NO_TOTALS;
    return res.status(201).json({ success: true, item: itemForAdmin(item.toObject(), seesPrices(req), totals) });
  } catch (error) {
    if (error.code === 11000) return bad(res, "There is already an item with this name.", 409);
    return serverError(res, "Adding a stock item failed", error);
  }
});

/* Common things an inn keeps, to get started quickly (quantity 0). */
const STARTER_ITEMS = [
  ["Toilet paper", "Toiletries", "rolls", 10],
  ["Bath soap", "Toiletries", "bars", 10],
  ["Shampoo", "Toiletries", "bottles", 5],
  ["Toothbrush & paste kits", "Toiletries", "kits", 5],
  ["Bed sheets", "Bed linen & towels", "pieces", 4],
  ["Pillow cases", "Bed linen & towels", "pieces", 4],
  ["Bath towels", "Bed linen & towels", "pieces", 4],
  ["Hand towels", "Bed linen & towels", "pieces", 4],
  ["Blankets", "Bed linen & towels", "pieces", 2],
  ["Drinking water (500 ml)", "Drinks", "bottles", 24],
  ["Soft drinks", "Drinks", "bottles", 12],
  ["Tea bags", "Food & kitchen", "boxes", 2],
  ["Coffee", "Food & kitchen", "packs", 2],
  ["Sugar", "Food & kitchen", "kg", 2],
  ["Floor cleaner", "Cleaning", "litres", 2],
  ["Washing powder", "Cleaning", "kg", 2],
  ["Bin bags", "Cleaning", "rolls", 2],
  ["Light bulbs", "Maintenance", "pieces", 3],
];

router.post("/items/starter", requirePermission("stock.items"), async (req, res) => {
  try {
    let added = 0;

    for (const [name, category, unit, lowStockAt] of STARTER_ITEMS) {
      if (!(await StockItem.exists({ nameKey: name.toLowerCase() }))) {
        await createItem({ name, category, unit, lowStockAt, unitCost: 0, notes: "" }, 0, req);
        added += 1;
      }
    }

    if (added) await audit(req.admin, "stock", `Added ${added} common items`);
    return res.status(201).json({ success: true, added });
  } catch (error) {
    return serverError(res, "Adding common items failed", error);
  }
});

router.patch("/items/:id", requirePermission("stock.items"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Unknown item.");

    const { values, error } = readItem(req.body || {}, true);
    if (error) return bad(res, error);
    if (!seesPrices(req)) delete values.unitCost; // only the owner changes prices
    if (!Object.keys(values).length) return bad(res, "Nothing to change.");

    const before = await StockItem.findById(req.params.id).lean();
    if (!before) return bad(res, "Item not found.", 404);

    if (values.name) {
      values.nameKey = values.name.toLowerCase();
      const clash = await StockItem.exists({ nameKey: values.nameKey, _id: { $ne: req.params.id } });
      if (clash) return bad(res, `There is already an item called "${values.name}".`, 409);
    }

    const item = await StockItem.findByIdAndUpdate(req.params.id, { $set: values }, {
      returnDocument: "after",
      runValidators: true,
    }).lean();

    if (!item) return bad(res, "Item not found.", 404);

    if (values.name) await StockMovement.updateMany({ item: item._id }, { $set: { itemName: item.name } });

    const said = [];
    if (values.name && values.name !== before.name) said.push(`renamed from ${before.name}`);
    if (values.active === false && before.active !== false) said.push("archived");
    if (values.active === true && before.active === false) said.push("brought back");
    if (values.unitCost !== undefined && values.unitCost !== (before.unitCost || 0)) {
      said.push(`price RWF ${before.unitCost || 0} to RWF ${values.unitCost}`);
    }
    if (values.lowStockAt !== undefined && values.lowStockAt !== before.lowStockAt) said.push(`warn at ${qtyText(values.lowStockAt)}`);
    await audit(req.admin, "stock", `Changed item ${item.name}` + (said.length ? `: ${said.join(", ")}` : ""));

    const waiting = await StockCount.findOne({ item: item._id, status: "waiting" }).lean();
    return res.json({ success: true, item: itemForAdmin(item, seesPrices(req), await totalsOf(item._id), waiting) });
  } catch (error) {
    if (error.code === 11000) return bad(res, "There is already an item with this name.", 409);
    return serverError(res, "Changing a stock item failed", error);
  }
});

/* ---------- Delete ---------- */

router.delete("/items/:id", requirePermission("stock.delete"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Unknown item.");

    const item = await StockItem.findById(req.params.id).lean();
    if (!item) return bad(res, "This item was already deleted.", 404);

    const removed = await StockMovement.deleteMany({ item: item._id });
    await StockCount.deleteMany({ item: item._id, status: "waiting" });
    await StockItem.deleteOne({ _id: item._id });
    await audit(req.admin, "stock", `Deleted item ${item.name} (${qtyText(item.quantity)} ${item.unit} left, ${removed.deletedCount || 0} changes)`);

    return res.json({ success: true, name: item.name, removedChanges: removed.deletedCount || 0 });
  } catch (error) {
    return serverError(res, "Deleting a stock item failed", error);
  }
});

/* Items nobody has counted, used or received yet (for example the common
   items added to get started), so they can be cleared in one go. */
router.post("/items/remove-unused", requirePermission("stock.delete"), async (req, res) => {
  try {
    const candidates = await StockItem.find({ quantity: 0 }).select("_id").lean();
    let removed = 0;

    for (const item of candidates) {
      const touched =
        (await StockMovement.exists({ item: item._id })) ||
        (await StockCount.exists({ item: item._id })) ||
        (await Purchase.exists({ "lines.item": item._id })) ||
        (await SupplyRequest.exists({ "lines.item": item._id }));

      if (!touched) {
        await StockItem.deleteOne({ _id: item._id, quantity: 0 });
        removed += 1;
      }
    }

    if (removed) await audit(req.admin, "stock", `Deleted ${removed} unused items`);
    return res.json({ success: true, removed });
  } catch (error) {
    return serverError(res, "Removing unused items failed", error);
  }
});

/* ---------- Issue and count ---------- */

router.post("/items/:id/movements", requirePermission("stock.view"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Unknown item.");

    const body = req.body || {};
    const type = body.type;

    if (type === "in") {
      return bad(res, "New stock comes in through a purchase: the owner records it, then it is checked in under Purchases.");
    }
    if (!["out", "count"].includes(type)) return bad(res, "Choose issue or count.");

    if (type === "out" && !can(req.admin, "stock.issue")) return denied(res, "Your role can't issue stock. Ask the manager.");
    if (type === "count" && !can(req.admin, "stock.count")) return denied(res, "Your role can't count stock. Ask the manager.");

    const quantity = amount(body.quantity, type === "count" ? 0 : 0.01, MAX_AMOUNT);
    if (quantity === null) {
      return bad(res, type === "count" ? "Enter how many there are now (0 or more)." : "Enter how many (more than 0).");
    }

    const department = text(body.department);
    if (type === "out" && !DEPARTMENTS.includes(department)) return bad(res, "Choose the department it is for.");

    const note = text(body.note);
    if (note.length > 200) return bad(res, "The note can be up to 200 characters.");

    const when = readDay(body);
    if (when.error) return bad(res, when.error);

    const item = await StockItem.findById(req.params.id).lean();
    if (!item) return bad(res, "Item not found.", 404);
    if (item.active === false) return bad(res, "This item is archived. Bring it back first.");

    const addedOn = kigaliDay(item.createdAt);
    if (when.dayText < addedOn) return bad(res, `${item.name} was added on ${addedOn}. Choose that day or later.`);

    const prices = seesPrices(req);

    // A manager's count with a difference waits for the owner.
    if (type === "count" && !can(req.admin, "stock.approve") && round(quantity - item.quantity) !== 0) {
      const values = {
        itemName: item.name,
        unit: item.unit,
        recorded: item.quantity,
        counted: quantity,
        change: round(quantity - item.quantity),
        note,
        day: when.day,
        countedById: req.admin._id,
        countedByName: req.admin.name,
      };

      // a newer count replaces one that is still waiting
      const count = await StockCount.findOneAndUpdate(
        { item: item._id, status: "waiting" },
        { $set: values, $setOnInsert: { item: item._id, status: "waiting" } },
        { upsert: true, returnDocument: "after" }
      ).lean();

      await audit(req.admin, "stock", `Counted ${item.name}: ${qtyText(quantity)} ${item.unit} (record says ${qtyText(item.quantity)}), waiting for the owner`);

      return res.status(202).json({
        success: true,
        waiting: true,
        count: countForAdmin(count),
        item: itemForAdmin(item, prices, await totalsOf(item._id), count),
      });
    }

    const result = await changeStock({
      itemId: item._id,
      type,
      quantity,
      change: type === "out" ? -quantity : (current) => round(quantity - current.quantity),
      person: req.admin,
      day: when.day,
      note,
      department: type === "out" ? department : "",
    });

    if (result.error) {
      const extra = result.status === 409 && type === "out" ? " If the number is wrong, count it." : "";
      return bad(res, result.error + extra, result.status);
    }

    // the owner's own count settles any count still waiting for this item
    if (type === "count") {
      await StockCount.updateMany(
        { item: item._id, status: "waiting" },
        { $set: { status: "rejected", decidedByName: req.admin.name, decidedAt: new Date(), reason: "Replaced by the owner's own count" } }
      );
    }

    const move = result.movement;
    await audit(
      req.admin,
      "stock",
      type === "out"
        ? `Issued ${qtyText(quantity)} ${item.unit} of ${item.name} to ${department}`
        : `Counted ${item.name}: ${qtyText(quantity)} ${item.unit} (change ${move.change > 0 ? "+" : ""}${qtyText(move.change)})`
    );

    return res.status(201).json({
      success: true,
      item: itemForAdmin(result.item, prices, await totalsOf(item._id), null),
      movement: movementForAdmin(move.toObject(), prices),
    });
  } catch (error) {
    return serverError(res, "Stock change failed", error);
  }
});

/* ---------- Count differences waiting for the owner ---------- */

router.get("/counts", requirePermission("stock.view"), async (req, res) => {
  try {
    const filter = req.query.status === "all" ? {} : { status: "waiting" };
    const counts = await StockCount.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    const prices = seesPrices(req);
    let costs = new Map();

    if (prices && counts.length) {
      const items = await StockItem.find({ _id: { $in: counts.map((c) => c.item) } }).select("unitCost").lean();
      costs = new Map(items.map((item) => [String(item._id), item.unitCost || 0]));
    }

    return res.json({
      success: true,
      counts: counts.map((count) => {
        const shown = countForAdmin(count);
        if (prices) shown.value = Math.round(count.change * (costs.get(String(count.item)) || 0));
        return shown;
      }),
    });
  } catch (error) {
    return serverError(res, "Count list failed", error);
  }
});

router.post("/counts/:id/approve", requirePermission("stock.approve"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Unknown count.");

    // claim it first, so it can't be approved twice
    const count = await StockCount.findOneAndUpdate(
      { _id: req.params.id, status: "waiting" },
      { $set: { status: "approved", decidedByName: req.admin.name, decidedAt: new Date() } },
      { returnDocument: "after" }
    ).lean();

    if (!count) return bad(res, "This count was already approved, turned down or replaced.", 409);

    const result = await changeStock({
      itemId: count.item,
      type: "count",
      quantity: count.counted,
      change: count.change,
      person: req.admin,
      day: count.day,
      note: `Count by ${count.countedByName}, approved` + (count.note ? `: ${count.note}` : ""),
    });

    if (result.error) {
      await StockCount.updateOne({ _id: count._id }, { $set: { status: "waiting", decidedByName: "", decidedAt: null } });
      const message = result.status === 409
        ? `${count.itemName} has changed since this count, so the difference can't be applied. Turn it down and ask for a new count.`
        : result.error;
      return bad(res, message, result.status);
    }

    await audit(req.admin, "stock", `Approved count of ${count.itemName} by ${count.countedByName}: change ${count.change > 0 ? "+" : ""}${qtyText(count.change)} ${count.unit}`);

    return res.json({
      success: true,
      count: countForAdmin(count),
      item: itemForAdmin(result.item, seesPrices(req), await totalsOf(count.item), null),
    });
  } catch (error) {
    return serverError(res, "Approving a count failed", error);
  }
});

router.post("/counts/:id/reject", requirePermission("stock.approve"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Unknown count.");

    const reason = text((req.body || {}).reason);
    if (reason.length > 200) return bad(res, "The reason can be up to 200 characters.");

    const count = await StockCount.findOneAndUpdate(
      { _id: req.params.id, status: "waiting" },
      { $set: { status: "rejected", decidedByName: req.admin.name, decidedAt: new Date(), reason } },
      { returnDocument: "after" }
    ).lean();

    if (!count) return bad(res, "This count was already approved, turned down or replaced.", 409);

    await audit(req.admin, "stock", `Turned down count of ${count.itemName} by ${count.countedByName}` + (reason ? `: ${reason}` : ""));
    return res.json({ success: true, count: countForAdmin(count) });
  } catch (error) {
    return serverError(res, "Turning down a count failed", error);
  }
});

/* ---------- History ---------- */

router.get("/movements", requirePermission("stock.view"), async (req, res) => {
  try {
    const filter = {};
    if (mongoose.isValidObjectId(req.query.itemId)) filter.item = req.query.itemId;

    const before = req.query.before ? new Date(req.query.before) : null;
    if (before && !Number.isNaN(before.getTime())) filter.createdAt = { $lt: before };

    const moves = await StockMovement.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    const prices = seesPrices(req);

    return res.json({ success: true, movements: moves.map((move) => movementForAdmin(move, prices)) });
  } catch (error) {
    return serverError(res, "Stock history failed", error);
  }
});

/* ---------- What was used and what is left, for a period ---------- */

router.get("/report", requirePermission("stock.view"), async (req, res) => {
  try {
    const todayText = innToday();
    let fromText = parseDay(req.query.from) ? req.query.from : `${todayText.slice(0, 8)}01`;

    if (req.query.from === "all") {
      const first = await StockMovement.findOne().sort({ day: 1 }).select("day").lean();
      fromText = first ? toDay(first.day) : todayText;
      if (fromText > todayText) fromText = todayText;
    }

    const toText = parseDay(req.query.to) ? req.query.to : todayText;

    if (toText < fromText) return bad(res, "The end date can't be before the start date.");

    const from = parseDay(fromText);
    const to = parseDay(toText);
    const prices = seesPrices(req);

    const [items, moves] = await Promise.all([
      StockItem.find().sort({ category: 1, name: 1 }).lean(),
      StockMovement.find({ day: { $gte: from } }).select("item type change day unitCost department").lean(),
    ]);

    const costOf = new Map(items.map((item) => [String(item._id), item.unitCost || 0]));

    const rows = items
      .map((item) => {
        const id = String(item._id);
        const mine = moves.filter((move) => String(move.item) === id);
        const inPeriod = mine.filter((move) => move.day <= to);
        const afterPeriod = mine.filter((move) => move.day > to);

        const sum = (list) => round(list.reduce((total, move) => total + move.change, 0));
        const received = sum(inPeriod.filter((move) => move.type === "in"));
        const used = -sum(inPeriod.filter((move) => move.type === "out"));
        const corrections = sum(inPeriod.filter((move) => move.type === "count"));
        const remaining = round(item.quantity - sum(afterPeriod));
        const atStart = round(remaining - received + used - corrections);

        const row = {
          _id: item._id,
          name: item.name,
          category: item.category,
          unit: item.unit,
          active: item.active !== false,
          atStart,
          received,
          used,
          corrections,
          remaining,
          lowStockAt: item.lowStockAt,
        };

        if (prices) {
          row.unitCost = item.unitCost || 0;
          row.usedValue = round(used * (item.unitCost || 0));
          row.correctionsValue = round(corrections * (item.unitCost || 0));
          row.remainingValue = round(remaining * (item.unitCost || 0));
        }

        return row;
      })
      // archived items only matter if something happened in the period
      .filter((row) => row.active || row.received || row.used || row.corrections);

    const report = { success: true, from: fromText, to: toText, rows };

    // Money (owner): what went to each department, and what was bought
    if (prices) {
      const departments = new Map(DEPARTMENTS.map((name) => [name, { department: name, issues: 0, value: 0 }]));

      moves
        .filter((move) => move.type === "out" && move.day <= to)
        .forEach((move) => {
          const name = move.department || "Not given";
          if (!departments.has(name)) departments.set(name, { department: name, issues: 0, value: 0 });
          const entry = departments.get(name);
          const cost = move.unitCost !== undefined && move.unitCost !== null ? move.unitCost : costOf.get(String(move.item)) || 0;
          entry.issues += 1;
          entry.value += -move.change * cost;
        });

      const bought = await Purchase.aggregate([
        { $match: { status: { $ne: "cancelled" }, day: { $gte: from, $lte: to } } },
        { $unwind: "$lines" },
        { $group: { _id: "$lines.category", spent: { $sum: { $multiply: ["$lines.quantity", "$lines.unitCost"] } } } },
      ]);

      report.departments = [...departments.values()].map((d) => ({ ...d, value: Math.round(d.value) }));
      report.spent = STOCK_CATEGORIES.map((category) => {
        const found = bought.find((row) => row._id === category);
        return { category, spent: found ? Math.round(found.spent) : 0 };
      });
    }

    return res.json(report);
  } catch (error) {
    return serverError(res, "Stock report failed", error);
  }
});

/* ---------- Monthly budgets (owner) ---------- */

router.get("/budget", requirePermission("budget.manage"), async (req, res) => {
  try {
    const month = validMonth(req.query.month) ? req.query.month : innToday().slice(0, 7);
    return res.json({ success: true, ...(await monthOverview(month)) });
  } catch (error) {
    return serverError(res, "Budget failed", error);
  }
});

router.put("/budget", requirePermission("budget.manage"), async (req, res) => {
  try {
    const body = req.body || {};
    if (!validMonth(body.month)) return bad(res, "Choose the month.");

    const amounts = body.amounts;
    if (!amounts || typeof amounts !== "object" || Array.isArray(amounts)) return bad(res, "Send the budget for each category.");

    const changes = [];

    for (const [category, value] of Object.entries(amounts)) {
      if (!STOCK_CATEGORIES.includes(category)) return bad(res, `Unknown category: ${category}.`);
      if (value === null || value === "") {
        changes.push({ category, amount: null });
        continue;
      }
      const rwf = money(value);
      if (rwf === null) return bad(res, `The budget for ${category} must be a whole number of RWF.`);
      changes.push({ category, amount: rwf });
    }

    for (const change of changes) {
      if (change.amount === null) await Budget.deleteOne({ month: body.month, category: change.category });
      else {
        await Budget.updateOne(
          { month: body.month, category: change.category },
          { $set: { amount: change.amount } },
          { upsert: true }
        );
      }
    }

    const overview = await monthOverview(body.month);
    await audit(req.admin, "budget", `Set the ${body.month} budget: RWF ${overview.totalBudget.toLocaleString("en-US")} in total`);

    return res.json({ success: true, ...overview });
  } catch (error) {
    return serverError(res, "Saving the budget failed", error);
  }
});

module.exports = router;
