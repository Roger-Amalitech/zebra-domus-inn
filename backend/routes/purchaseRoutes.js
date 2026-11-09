/* =========================================
   ZEBRA DORMUS INN
   Purchases, mounted at /api/admin/purchases

   GET   /                 latest purchases, waiting ones first        (purchases.view)
   POST  /                 { supplier, day, note?, lines: [{ itemId, quantity, unitCost }] }
                           the owner records what was bought           (purchases.record)
   POST  /:id/receive      { lines: [{ itemId, received }], note? }
                           the manager checks it into the store; only
                           now does the stock go up                    (purchases.receive)
   POST  /:id/cancel       a purchase that hasn't been checked in      (purchases.record)

   Prices and totals are only shown to the owner (stock.prices).
========================================= */

const express = require("express");
const mongoose = require("mongoose");

const Purchase = require("../models/Purchase");
const StockItem = require("../models/StockItem");
const { can, requirePermission } = require("../utils/permissions");
const { parseDay, toDay, addDays, innToday } = require("../utils/availability");
const { audit } = require("../utils/audit");
const { overBudget } = require("../utils/budget");
const { MAX_AMOUNT, amount, money, text, qtyText, nextRef, changeStock } = require("../utils/stockOps");

const DAYS_BACK = 60;
const MAX_LINES = 30;

const router = express.Router();

function bad(res, message, status = 400) {
  return res.status(status).json({ success: false, message });
}

function serverError(res, label, error) {
  console.error(`${label}:`, error.message);
  return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
}

function rwf(value) {
  return `RWF ${Math.round(value).toLocaleString("en-US")}`;
}

function purchaseForAdmin(purchase, prices) {
  const shown = {
    _id: purchase._id,
    ref: purchase.ref,
    supplier: purchase.supplier,
    day: toDay(purchase.day),
    note: purchase.note || "",
    status: purchase.status,
    lines: purchase.lines.map((line) => {
      const row = {
        itemId: line.item,
        itemName: line.itemName,
        unit: line.unit,
        category: line.category,
        quantity: line.quantity,
        received: line.received === undefined ? null : line.received,
      };
      if (prices) row.unitCost = line.unitCost;
      return row;
    }),
    createdByName: purchase.createdByName,
    createdAt: purchase.createdAt,
    receivedByName: purchase.receivedByName || "",
    receivedAt: purchase.receivedAt || null,
    receiveNote: purchase.receiveNote || "",
    cancelledByName: purchase.cancelledByName || "",
    cancelledAt: purchase.cancelledAt || null,
  };

  shown.short = purchase.status === "received" && purchase.lines.some((line) => (line.received || 0) < line.quantity);
  if (prices) shown.total = purchase.total;

  return shown;
}

router.get("/", requirePermission("purchases.view"), async (req, res) => {
  try {
    const [waiting, done] = await Promise.all([
      Purchase.find({ status: "waiting" }).sort({ day: 1, createdAt: 1 }).lean(),
      Purchase.find({ status: { $ne: "waiting" } }).sort({ day: -1, createdAt: -1 }).limit(100).lean(),
    ]);
    const prices = can(req.admin, "stock.prices");

    return res.json({
      success: true,
      purchases: waiting.concat(done).map((purchase) => purchaseForAdmin(purchase, prices)),
    });
  } catch (error) {
    return serverError(res, "Purchase list failed", error);
  }
});

router.post("/", requirePermission("purchases.record"), async (req, res) => {
  try {
    const body = req.body || {};
    const supplier = text(body.supplier);
    const note = text(body.note);

    if (!supplier || supplier.length > 80) return bad(res, "Please enter where it was bought (up to 80 characters).");
    if (note.length > 300) return bad(res, "The note can be up to 300 characters.");

    const todayText = innToday();
    const dayText = text(body.day) || todayText;
    const day = parseDay(dayText);
    if (!day) return bad(res, "Please choose the day it was bought.");
    if (dayText > todayText) return bad(res, "The day can't be in the future.");
    if (day < addDays(parseDay(todayText), -DAYS_BACK)) return bad(res, `The day can be up to ${DAYS_BACK} days ago.`);

    if (!Array.isArray(body.lines) || !body.lines.length) return bad(res, "Add at least one item.");
    if (body.lines.length > MAX_LINES) return bad(res, `A purchase can have up to ${MAX_LINES} items.`);

    const lines = [];
    const seen = new Set();

    for (const raw of body.lines) {
      const line = raw || {};
      if (!mongoose.isValidObjectId(line.itemId)) return bad(res, "Choose the item for every line.");

      const item = await StockItem.findById(line.itemId).lean();
      if (!item) return bad(res, "One of the items no longer exists. Reload the page.", 404);
      if (item.active === false) return bad(res, `${item.name} is archived. Bring it back first.`);
      if (seen.has(String(item._id))) return bad(res, `${item.name} is listed twice. Put it on one line.`);
      seen.add(String(item._id));

      const quantity = amount(line.quantity, 0.01, MAX_AMOUNT);
      if (quantity === null) return bad(res, `Enter how many ${item.unit} of ${item.name} were bought.`);

      const unitCost = money(line.unitCost);
      if (unitCost === null) return bad(res, `Enter the price for one ${item.name} as a whole number of RWF.`);

      lines.push({
        item: item._id,
        itemName: item.name,
        unit: item.unit,
        category: item.category,
        quantity,
        unitCost,
      });
    }

    const total = Math.round(lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0));
    const warnings = await overBudget(dayText.slice(0, 7), lines);

    const purchase = await Purchase.create({
      ref: await nextRef("P"),
      supplier,
      day,
      note,
      lines,
      total,
      status: "waiting",
      createdById: req.admin._id,
      createdByName: req.admin.name,
    });

    await audit(
      req.admin,
      "purchases",
      `Recorded purchase ${purchase.ref} from ${supplier}: ${lines.length} item${lines.length === 1 ? "" : "s"}, ${rwf(total)}` +
        warnings.map((w) => `; over the ${w.category} budget by ${rwf(w.over)}`).join("")
    );

    return res.status(201).json({ success: true, purchase: purchaseForAdmin(purchase.toObject(), true), warnings });
  } catch (error) {
    return serverError(res, "Recording a purchase failed", error);
  }
});

router.post("/:id/receive", requirePermission("purchases.receive"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Unknown purchase.");

    const body = req.body || {};
    const note = text(body.note);
    if (note.length > 300) return bad(res, "The note can be up to 300 characters.");

    const purchase = await Purchase.findById(req.params.id).lean();
    if (!purchase) return bad(res, "Purchase not found.", 404);
    if (purchase.status !== "waiting") return bad(res, "This purchase was already checked in or cancelled.", 409);

    const given = new Map((Array.isArray(body.lines) ? body.lines : []).map((line) => [String((line || {}).itemId), (line || {}).received]));
    const received = [];

    for (const line of purchase.lines) {
      const value = given.has(String(line.item)) ? given.get(String(line.item)) : line.quantity;
      const number = amount(value, 0, line.quantity);
      if (number === null) {
        return bad(res, `For ${line.itemName}, enter how many came in: 0 to ${qtyText(line.quantity)} ${line.unit}.`);
      }
      received.push(number);
    }

    if (received.every((number) => number === 0)) {
      return bad(res, "Nothing came in? Ask the owner to cancel the purchase instead.");
    }

    // claim it first, so it can't be checked in twice
    const claimed = await Purchase.findOneAndUpdate(
      { _id: purchase._id, status: "waiting" },
      {
        $set: {
          status: "received",
          receivedById: req.admin._id,
          receivedByName: req.admin.name,
          receivedAt: new Date(),
          receiveNote: note,
        },
      },
      { returnDocument: "after" }
    );

    if (!claimed) return bad(res, "This purchase was already checked in or cancelled.", 409);

    const day = parseDay(innToday());
    const said = [];

    for (let i = 0; i < claimed.lines.length; i += 1) {
      const line = claimed.lines[i];
      let got = received[i];

      if (got > 0) {
        const result = await changeStock({
          itemId: line.item,
          type: "in",
          quantity: got,
          change: got,
          person: req.admin,
          day,
          note: `Purchase ${claimed.ref} from ${claimed.supplier}`,
          ref: claimed.ref,
          unitCost: line.unitCost,
          setCost: line.unitCost > 0 ? line.unitCost : undefined,
        });

        if (result.error) got = 0; // the item was deleted meanwhile
      }

      line.received = got;
      if (got < line.quantity) said.push(`${line.itemName} ${qtyText(got)} of ${qtyText(line.quantity)}`);
    }

    await claimed.save();

    await audit(
      req.admin,
      "purchases",
      `Checked in purchase ${claimed.ref} from ${claimed.supplier}` + (said.length ? `; short: ${said.join(", ")}` : ", everything came in")
    );

    return res.json({ success: true, purchase: purchaseForAdmin(claimed.toObject(), can(req.admin, "stock.prices")) });
  } catch (error) {
    return serverError(res, "Checking in a purchase failed", error);
  }
});

router.post("/:id/cancel", requirePermission("purchases.record"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Unknown purchase.");

    const purchase = await Purchase.findOneAndUpdate(
      { _id: req.params.id, status: "waiting" },
      { $set: { status: "cancelled", cancelledByName: req.admin.name, cancelledAt: new Date() } },
      { returnDocument: "after" }
    ).lean();

    if (!purchase) return bad(res, "Only a purchase that hasn't been checked in can be cancelled.", 409);

    await audit(req.admin, "purchases", `Cancelled purchase ${purchase.ref} from ${purchase.supplier} (${rwf(purchase.total)})`);
    return res.json({ success: true, purchase: purchaseForAdmin(purchase, true) });
  } catch (error) {
    return serverError(res, "Cancelling a purchase failed", error);
  }
});

module.exports = router;
