/* =========================================
   ZEBRA DORMUS INN
   Stock (store room), mounted at /api/admin/stock

   GET   /items                      everything in store (?archived=1 to include archived)
   POST  /items                      add an item (owner)
   POST  /items/starter              add a list of common inn items (owner)
   PATCH /items/:id                  change name, unit, warning level, price, archive (owner)
   POST  /items/:id/movements        { type: in|out|count, quantity, note?, day?, unitCost? }
   GET   /movements                  ?itemId &before  latest changes
   GET   /report                     ?from=YYYY-MM-DD &to=YYYY-MM-DD  start, received, used, left

   Staff can record what was used, received or counted.
   Only the owner adds or changes items and sees prices.
========================================= */

const express = require("express");
const mongoose = require("mongoose");

const StockItem = require("../models/StockItem");
const StockMovement = require("../models/StockMovement");
const { requireOwner } = require("../utils/adminAuth");
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

function isOwner(req) {
  return req.admin && req.admin.role === "owner";
}

function statusOf(item) {
  if (item.quantity <= 0) return "out";
  if (item.quantity <= item.lowStockAt) return "low";
  return "ok";
}

function itemForAdmin(item, owner) {
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

  if (owner) {
    shown.unitCost = item.unitCost || 0;
    shown.value = round((item.unitCost || 0) * item.quantity);
  }

  return shown;
}

function movementForAdmin(move, owner) {
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

  if (owner && move.unitCost !== undefined) shown.unitCost = move.unitCost;

  return shown;
}

/* Reads the item fields the owner sends. */
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
    const items = await StockItem.find(filter).sort({ category: 1, name: 1 }).lean();
    const owner = isOwner(req);
    const active = items.filter((item) => item.active !== false);

    const summary = {
      items: active.length,
      low: active.filter((item) => statusOf(item) === "low").length,
      out: active.filter((item) => statusOf(item) === "out").length,
    };

    if (owner) summary.value = round(active.reduce((sum, item) => sum + (item.unitCost || 0) * item.quantity, 0));

    return res.json({
      success: true,
      categories: STOCK_CATEGORIES,
      summary,
      items: items.map((item) => itemForAdmin(item, owner)),
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

router.post("/items", requireOwner, async (req, res) => {
  try {
    const body = req.body || {};
    const { values, error } = readItem(body, false);
    if (error) return bad(res, error);

    const quantity = body.quantity === undefined || body.quantity === "" ? 0 : amount(body.quantity, 0, MAX_AMOUNT);
    if (quantity === null) return bad(res, "The starting quantity must be a number, 0 or more.");

    if (await StockItem.exists({ nameKey: values.name.toLowerCase() })) {
      return bad(res, `There is already an item called "${values.name}".`, 409);
    }

    const item = await createItem(values, quantity, req);
    return res.status(201).json({ success: true, item: itemForAdmin(item.toObject(), true) });
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

router.post("/items/starter", requireOwner, async (req, res) => {
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

router.patch("/items/:id", requireOwner, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Unknown item.");

    const { values, error } = readItem(req.body || {}, true);
    if (error) return bad(res, error);
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

    return res.json({ success: true, item: itemForAdmin(item, true) });
  } catch (error) {
    if (error.code === 11000) return bad(res, "There is already an item with this name.", 409);
    return serverError(res, "Changing a stock item failed", error);
  }
});

/* ---------- Used / received / counted ---------- */

router.post("/items/:id/movements", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Unknown item.");

    const body = req.body || {};
    const type = body.type;
    if (!["in", "out", "count"].includes(type)) return bad(res, "Choose used, received or counted.");

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
    if (type === "in" && body.unitCost !== undefined && body.unitCost !== "" && isOwner(req)) {
      unitCost = amount(body.unitCost, 0, 100000000);
      if (unitCost === null || !Number.isInteger(unitCost)) return bad(res, "The price must be a whole number of RWF.");
    }

    // Change the quantity only if nobody else changed it at the same moment.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const item = await StockItem.findById(req.params.id).lean();
      if (!item) return bad(res, "Item not found.", 404);
      if (item.active === false) return bad(res, "This item is archived. The owner can bring it back first.");

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

      return res.status(201).json({
        success: true,
        item: itemForAdmin(updated, isOwner(req)),
        movement: movementForAdmin(move.toObject(), isOwner(req)),
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
    const owner = isOwner(req);

    return res.json({ success: true, movements: moves.map((move) => movementForAdmin(move, owner)) });
  } catch (error) {
    return serverError(res, "Stock history failed", error);
  }
});

/* ---------- What was used and what is left, for a period ---------- */

router.get("/report", async (req, res) => {
  try {
    const todayText = innToday();
    const fromText = parseDay(req.query.from) ? req.query.from : `${todayText.slice(0, 8)}01`;
    const toText = parseDay(req.query.to) ? req.query.to : todayText;

    if (toText < fromText) return bad(res, "The end date can't be before the start date.");

    const from = parseDay(fromText);
    const to = parseDay(toText);
    const owner = isOwner(req);

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

        if (owner) {
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
