/* =========================================
   ZEBRA DORMUS INN
   Stock (store room), mounted at /api/admin/stock

   GET   /items                      everything in store, with in stock / used / remaining
                                     since each item was added (?archived=1 to include archived)
   POST  /items                      add an item                              (stock.items)
   POST  /items/starter              add a list of common inn items           (stock.items)
   PATCH /items/:id                  change name, unit, warning level, archive (stock.items)
   DELETE /items/:id                 delete an item and its history           (stock.items)
   POST  /items/remove-unused        delete items never counted, used or received (stock.items)
   POST  /items/:id/movements        { type: in|out|count, quantity, note?, day?, unitCost? }
                                     out needs stock.use, in stock.receive, count stock.count
   GET   /movements                  ?itemId &before  latest changes
   GET   /report                     ?from=YYYY-MM-DD|all &to=YYYY-MM-DD  start, received, used, left
                                     (from=all: since the first change ever recorded)

   Everything here needs stock.view (checked in adminRoutes.js).
   Prices and value are only shown to people with stock.prices.
========================================= */

const express = require("express");
const mongoose = require("mongoose");

const StockItem = require("../models/StockItem");
const StockMovement = require("../models/StockMovement");
const { can, requirePermission, denied } = require("../utils/permissions");
const { parseDay, toDay, addDays, innToday } = require("../utils/availability");

const { STOCK_CATEGORIES } = StockItem;
const MAX_AMOUNT = 1000000;
const DAYS_BACK = 60;

const router = express.Router();

/* ---------- Helpers ---------- */

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function bad(res, message, status = 400) {
  return res.status(status).json({ success: false, message });
}

function serverError(res, label, error) {
  console.error(`${label}:`, error.message);
  return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
}

// keep quantities to 2 decimals (2.5 kg) and avoid 0.30000000000000004
function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

// a number with at most 2 decimals, between min and max
function amount(value, min, max) {
  const number = Number(value);
  if (value === "" || value === null || !Number.isFinite(number)) return null;
  if (number < min || number > max) return null;
  if (Math.abs(round(number) - number) > 1e-9) return null;
  return round(number);
}

// the Rwanda date of a moment, as "YYYY-MM-DD"
function kigaliDay(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kigali",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// prices and the value of the stock are only for people with stock.prices
function seesPrices(req) {
  return can(req.admin, "stock.prices");
}

const manageItems = requirePermission("stock.items");

const MOVE_PERMISSION = {
  out: ["stock.use", "record what was used"],
  in: ["stock.receive", "record what came in"],
  count: ["stock.count", "correct numbers after counting"],
};

/* In stock, used and corrections since each item was added.
   Starting stock is saved as "received", so for every item:
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

function statusOf(item) {
  if (item.quantity <= 0) return "out";
  if (item.quantity <= item.lowStockAt) return "low";
  return "ok";
}

function itemForAdmin(item, prices, totals) {
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
    day: toDay(move.day),
    userName: move.userName || "",
    createdAt: move.createdAt,
  };

  if (prices && move.unitCost !== undefined) shown.unitCost = move.unitCost;

  return shown;
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
    values.unitCost = has("unitCost") && body.unitCost !== "" ? amount(body.unitCost, 0, 100000000) : 0;
    if (values.unitCost === null || !Number.isInteger(values.unitCost)) {
      return { error: "The price must be a whole number of RWF." };
    }
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

router.get("/items", async (req, res) => {
  try {
    const filter = req.query.archived === "1" ? {} : { active: true };
    const [items, totals] = await Promise.all([
      StockItem.find(filter).sort({ category: 1, name: 1 }).lean(),
      totalsFor(null),
    ]);
    const prices = seesPrices(req);
    const active = items.filter((item) => item.active !== false);

    const summary = {
      items: active.length,
      low: active.filter((item) => statusOf(item) === "low").length,
      out: active.filter((item) => statusOf(item) === "out").length,
    };

    if (prices) summary.value = round(active.reduce((sum, item) => sum + (item.unitCost || 0) * item.quantity, 0));

    return res.json({
      success: true,
      categories: STOCK_CATEGORIES,
      summary,
      items: items.map((item) => itemForAdmin(item, prices, totals.get(String(item._id)) || NO_TOTALS)),
    });
  } catch (error) {
    return serverError(res, "Stock list failed", error);
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

router.post("/items", manageItems, async (req, res) => {
  try {
    const body = req.body || {};
    const { values, error } = readItem(body, false);
    if (error) return bad(res, error);
    if (!seesPrices(req)) values.unitCost = 0;

    const quantity = body.quantity === undefined || body.quantity === "" ? 0 : amount(body.quantity, 0, MAX_AMOUNT);
    if (quantity === null) return bad(res, "The starting quantity must be a number, 0 or more.");

    if (await StockItem.exists({ nameKey: values.name.toLowerCase() })) {
      return bad(res, `There is already an item called "${values.name}".`, 409);
    }

    const item = await createItem(values, quantity, req);
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

router.post("/items/starter", manageItems, async (req, res) => {
  try {
    let added = 0;

    for (const [name, category, unit, lowStockAt] of STARTER_ITEMS) {
      if (!(await StockItem.exists({ nameKey: name.toLowerCase() }))) {
        await createItem({ name, category, unit, lowStockAt, unitCost: 0, notes: "" }, 0, req);
        added += 1;
      }
    }

    return res.status(201).json({ success: true, added });
  } catch (error) {
    return serverError(res, "Adding common items failed", error);
  }
});

router.patch("/items/:id", manageItems, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Unknown item.");

    const { values, error } = readItem(req.body || {}, true);
    if (error) return bad(res, error);
    if (!seesPrices(req)) delete values.unitCost; // only people who see prices change them
    if (!Object.keys(values).length) return bad(res, "Nothing to change.");

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

    const totals = (await totalsFor([item._id])).get(String(item._id)) || NO_TOTALS;
    return res.json({ success: true, item: itemForAdmin(item, seesPrices(req), totals) });
  } catch (error) {
    if (error.code === 11000) return bad(res, "There is already an item with this name.", 409);
    return serverError(res, "Changing a stock item failed", error);
  }
});

/* ---------- Delete ---------- */

router.delete("/items/:id", manageItems, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Unknown item.");

    const item = await StockItem.findById(req.params.id).lean();
    if (!item) return bad(res, "This item was already deleted.", 404);

    const removed = await StockMovement.deleteMany({ item: item._id });
    await StockItem.deleteOne({ _id: item._id });

    return res.json({ success: true, name: item.name, removedChanges: removed.deletedCount || 0 });
  } catch (error) {
    return serverError(res, "Deleting a stock item failed", error);
  }
});

/* Items nobody has counted, used or received yet (for example the common
   items added to get started), so they can be cleared in one go. */
router.post("/items/remove-unused", manageItems, async (req, res) => {
  try {
    const candidates = await StockItem.find({ quantity: 0 }).select("_id").lean();
    let removed = 0;

    for (const item of candidates) {
      if (!(await StockMovement.exists({ item: item._id }))) {
        await StockItem.deleteOne({ _id: item._id, quantity: 0 });
        removed += 1;
      }
    }

    return res.json({ success: true, removed });
  } catch (error) {
    return serverError(res, "Removing unused items failed", error);
  }
});

/* ---------- Used / received / counted ---------- */

router.post("/items/:id/movements", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Unknown item.");

    const body = req.body || {};
    const type = body.type;
    if (!["in", "out", "count"].includes(type)) return bad(res, "Choose used, received or counted.");

    const [permission, action] = MOVE_PERMISSION[type];
    if (!can(req.admin, permission)) {
      return denied(res, `You don't have permission to ${action}. Ask the manager.`);
    }

    const quantity = amount(body.quantity, type === "count" ? 0 : 0.01, MAX_AMOUNT);
    if (quantity === null) {
      return bad(res, type === "count" ? "Enter how many there are now (0 or more)." : "Enter how many (more than 0).");
    }

    const note = text(body.note);
    if (note.length > 200) return bad(res, "The note can be up to 200 characters.");

    const todayText = innToday();
    const dayText = text(body.day) || todayText;
    const day = parseDay(dayText);
    if (!day) return bad(res, "Please choose the day.");
    if (dayText > todayText) return bad(res, "The day can't be in the future.");
    if (day < addDays(parseDay(todayText), -DAYS_BACK)) return bad(res, `The day can be up to ${DAYS_BACK} days ago.`);

    let unitCost;
    if (type === "in" && body.unitCost !== undefined && body.unitCost !== "" && seesPrices(req)) {
      unitCost = amount(body.unitCost, 0, 100000000);
      if (unitCost === null || !Number.isInteger(unitCost)) return bad(res, "The price must be a whole number of RWF.");
    }

    // Change the quantity only if nobody else changed it at the same moment.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const item = await StockItem.findById(req.params.id).lean();
      if (!item) return bad(res, "Item not found.", 404);
      if (item.active === false) return bad(res, "This item is archived. Someone who manages items can bring it back first.");

      const addedOn = kigaliDay(item.createdAt);
      if (dayText < addedOn) return bad(res, `${item.name} was added on ${addedOn}. Choose that day or later.`);

      let change;
      if (type === "in") change = quantity;
      else if (type === "out") change = -quantity;
      else change = round(quantity - item.quantity);

      const balanceAfter = round(item.quantity + change);

      if (balanceAfter < 0) {
        return bad(
          res,
          `Only ${item.quantity} ${item.unit} of ${item.name} ${item.quantity === 1 ? "is" : "are"} in stock. If the number is wrong, use "Count" to correct it.`,
          409
        );
      }

      const set = { quantity: balanceAfter };
      if (unitCost !== undefined) set.unitCost = unitCost; // remember the latest price paid

      const updated = await StockItem.findOneAndUpdate(
        { _id: item._id, quantity: item.quantity },
        { $set: set },
        { returnDocument: "after" }
      ).lean();

      if (!updated) continue; // someone else changed it: read again

      const move = await StockMovement.create({
        item: item._id,
        itemName: item.name,
        type,
        quantity,
        change,
        balanceAfter,
        unitCost,
        note,
        day,
        userId: req.admin._id,
        userName: req.admin.name,
      });

      const totals = (await totalsFor([item._id])).get(String(item._id)) || NO_TOTALS;

      return res.status(201).json({
        success: true,
        item: itemForAdmin(updated, seesPrices(req), totals),
        movement: movementForAdmin(move.toObject(), seesPrices(req)),
      });
    }

    return bad(res, "Someone else is changing this item right now. Please try again.", 409);
  } catch (error) {
    return serverError(res, "Stock change failed", error);
  }
});

router.get("/movements", async (req, res) => {
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

router.get("/report", async (req, res) => {
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
      StockMovement.find({ day: { $gte: from } }).select("item type change day unitCost").lean(),
    ]);

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
          row.remainingValue = round(remaining * (item.unitCost || 0));
        }

        return row;
      })
      // archived items only matter if something happened in the period
      .filter((row) => row.active || row.received || row.used || row.corrections);

    return res.json({ success: true, from: fromText, to: toText, rows });
  } catch (error) {
    return serverError(res, "Stock report failed", error);
  }
});

module.exports = router;
