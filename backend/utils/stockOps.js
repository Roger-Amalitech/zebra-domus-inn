/* =========================================
   ZEBRA DORMUS INN
   Shared stock helpers: numbers, references and safe quantity changes.
========================================= */

const StockItem = require("../models/StockItem");
const StockMovement = require("../models/StockMovement");
const Counter = require("../models/Counter");

const MAX_AMOUNT = 1000000;

// keep quantities to 2 decimals (2.5 kg) and avoid 0.30000000000000004
function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

// a number with at most 2 decimals, between min and max (null if not)
function amount(value, min, max) {
  const number = Number(value);
  if (value === "" || value === null || value === undefined || !Number.isFinite(number)) return null;
  if (number < min || number > max) return null;
  if (Math.abs(round(number) - number) > 1e-9) return null;
  return round(number);
}

// a whole number of RWF (null if not)
function money(value) {
  const number = amount(value, 0, 100000000);
  return number !== null && Number.isInteger(number) ? number : null;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
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

function qtyText(value) {
  return String(round(value));
}

/* The next reference: P-0001, R-0001... */
async function nextRef(prefix) {
  const counter = await Counter.findOneAndUpdate(
    { _id: prefix },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" }
  ).lean();
  return `${prefix}-${String(counter.seq).padStart(4, "0")}`;
}

/* Changes an item's quantity by `change` (can be negative), but only if
   nobody else changed it at the same moment, and never below zero.
   Saves a movement too. Returns { item, movement } or { error, status }. */
async function changeStock({ itemId, type, quantity, change, person, day, note, department, ref, unitCost, setCost }) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const item = await StockItem.findById(itemId).lean();
    if (!item) return { error: "Item not found.", status: 404 };

    const delta = typeof change === "function" ? change(item) : change;
    const balanceAfter = round(item.quantity + delta);

    if (balanceAfter < 0) {
      return {
        error: `Only ${qtyText(item.quantity)} ${item.unit} of ${item.name} ${item.quantity === 1 ? "is" : "are"} in stock.`,
        status: 409,
        item,
      };
    }

    const set = { quantity: balanceAfter };
    if (setCost !== undefined) set.unitCost = setCost; // remember the latest price paid

    const updated = await StockItem.findOneAndUpdate(
      { _id: item._id, quantity: item.quantity },
      { $set: set },
      { returnDocument: "after" }
    ).lean();

    if (!updated) continue; // someone else changed it: read again

    const movement = await StockMovement.create({
      item: item._id,
      itemName: item.name,
      type,
      quantity,
      change: round(delta),
      balanceAfter,
      unitCost: unitCost !== undefined ? unitCost : item.unitCost || undefined,
      note: note || "",
      day,
      department: department || "",
      ref: ref || "",
      userId: person._id,
      userName: person.name,
    });

    return { item: updated, before: item, movement };
  }

  return { error: "Someone else is changing this item right now. Please try again.", status: 409 };
}

module.exports = {
  MAX_AMOUNT,
  round,
  amount,
  money,
  text,
  kigaliDay,
  qtyText,
  nextRef,
  changeStock,
};
