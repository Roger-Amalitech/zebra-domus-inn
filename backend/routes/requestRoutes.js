/* =========================================
   ZEBRA DORMUS INN
   Supply requests, mounted at /api/admin/requests

   GET   /                staff: their own requests; manager/owner: everyone's
   POST  /                { department, note?, lines: [{ itemId, quantity }] }   (requests.make)
   POST  /:id/cancel      the person who asked, while it is waiting
   POST  /:id/issue       { lines: [{ itemId, issued }], note? }
                          the manager hands it over; the stock goes down      (requests.manage)
   POST  /:id/reject      { reason? }                                         (requests.manage)
   POST  /:id/received    the person who asked confirms they got it

   Staff never change stock numbers themselves.
========================================= */

const express = require("express");
const mongoose = require("mongoose");

const SupplyRequest = require("../models/SupplyRequest");
const StockItem = require("../models/StockItem");
const { can, requireAny, requirePermission, denied } = require("../utils/permissions");
const { parseDay, innToday } = require("../utils/availability");
const { DEPARTMENTS } = require("../utils/departments");
const { audit } = require("../utils/audit");
const { MAX_AMOUNT, amount, text, qtyText, nextRef, changeStock } = require("../utils/stockOps");

const MAX_LINES = 20;

const router = express.Router();

function bad(res, message, status = 400) {
  return res.status(status).json({ success: false, message });
}

function serverError(res, label, error) {
  console.error(`${label}:`, error.message);
  return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
}

function isMine(req, request) {
  return String(request.requestedById) === String(req.admin._id);
}

function linesText(lines, key) {
  return lines
    .filter((line) => (key ? line[key] > 0 : true))
    .map((line) => `${line.itemName} ${qtyText(key ? line[key] : line.quantity)} ${line.unit}`)
    .join(", ");
}

function requestForAdmin(request, req) {
  return {
    _id: request._id,
    ref: request.ref,
    department: request.department,
    note: request.note || "",
    status: request.status,
    lines: request.lines.map((line) => ({
      itemId: line.item,
      itemName: line.itemName,
      unit: line.unit,
      quantity: line.quantity,
      issued: line.issued === undefined ? null : line.issued,
    })),
    requestedByName: request.requestedByName,
    mine: isMine(req, request),
    createdAt: request.createdAt,
    issuedByName: request.issuedByName || "",
    issuedAt: request.issuedAt || null,
    issueNote: request.issueNote || "",
    rejectReason: request.rejectReason || "",
    receivedAt: request.receivedAt || null,
  };
}

const ORDER = { waiting: 0, issued: 1, received: 2, rejected: 3, cancelled: 4 };

router.get("/", requireAny("requests.make", "requests.manage"), async (req, res) => {
  try {
    const filter = can(req.admin, "requests.manage") ? {} : { requestedById: req.admin._id };
    const [open, done] = await Promise.all([
      SupplyRequest.find({ ...filter, status: { $in: ["waiting", "issued"] } }).sort({ createdAt: 1 }).lean(),
      SupplyRequest.find({ ...filter, status: { $nin: ["waiting", "issued"] } }).sort({ updatedAt: -1 }).limit(100).lean(),
    ]);

    open.sort((a, b) => ORDER[a.status] - ORDER[b.status]);

    return res.json({
      success: true,
      departments: DEPARTMENTS,
      requests: open.concat(done).map((request) => requestForAdmin(request, req)),
    });
  } catch (error) {
    return serverError(res, "Request list failed", error);
  }
});

router.post("/", requirePermission("requests.make"), async (req, res) => {
  try {
    const body = req.body || {};
    const department = text(body.department);
    const note = text(body.note);

    if (!DEPARTMENTS.includes(department)) return bad(res, "Choose your department.");
    if (note.length > 200) return bad(res, "The note can be up to 200 characters.");
    if (!Array.isArray(body.lines) || !body.lines.length) return bad(res, "Add at least one item.");
    if (body.lines.length > MAX_LINES) return bad(res, `A request can have up to ${MAX_LINES} items.`);

    const lines = [];
    const seen = new Set();

    for (const raw of body.lines) {
      const line = raw || {};
      if (!mongoose.isValidObjectId(line.itemId)) return bad(res, "Choose the item for every line.");

      const item = await StockItem.findById(line.itemId).lean();
      if (!item || item.active === false) return bad(res, "One of the items is no longer in the list. Reload the page.", 404);
      if (seen.has(String(item._id))) return bad(res, `${item.name} is listed twice. Put it on one line.`);
      seen.add(String(item._id));

      const quantity = amount(line.quantity, 0.01, MAX_AMOUNT);
      if (quantity === null) return bad(res, `Enter how many ${item.unit} of ${item.name} you need.`);

      lines.push({ item: item._id, itemName: item.name, unit: item.unit, quantity });
    }

    const request = await SupplyRequest.create({
      ref: await nextRef("R"),
      department,
      note,
      lines,
      status: "waiting",
      requestedById: req.admin._id,
      requestedByName: req.admin.name,
    });

    await audit(req.admin, "requests", `Asked for supplies ${request.ref} for ${department}: ${linesText(lines)}`);
    return res.status(201).json({ success: true, request: requestForAdmin(request.toObject(), req) });
  } catch (error) {
    return serverError(res, "Making a request failed", error);
  }
});

router.post("/:id/cancel", requireAny("requests.make", "requests.manage"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Unknown request.");

    const request = await SupplyRequest.findById(req.params.id).lean();
    if (!request) return bad(res, "Request not found.", 404);
    if (!isMine(req, request)) return denied(res, "Only the person who asked can cancel a request. Managers can turn it down.");

    const updated = await SupplyRequest.findOneAndUpdate(
      { _id: request._id, status: "waiting" },
      { $set: { status: "cancelled" } },
      { returnDocument: "after" }
    ).lean();

    if (!updated) return bad(res, "This request has already been handled.", 409);

    await audit(req.admin, "requests", `Cancelled request ${request.ref}`);
    return res.json({ success: true, request: requestForAdmin(updated, req) });
  } catch (error) {
    return serverError(res, "Cancelling a request failed", error);
  }
});

router.post("/:id/issue", requirePermission("requests.manage"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Unknown request.");

    const body = req.body || {};
    const note = text(body.note);
    if (note.length > 200) return bad(res, "The note can be up to 200 characters.");

    const request = await SupplyRequest.findById(req.params.id).lean();
    if (!request) return bad(res, "Request not found.", 404);
    if (request.status !== "waiting") return bad(res, "This request has already been handled.", 409);

    const given = new Map((Array.isArray(body.lines) ? body.lines : []).map((line) => [String((line || {}).itemId), (line || {}).issued]));
    const issued = [];

    for (const line of request.lines) {
      const value = given.has(String(line.item)) ? given.get(String(line.item)) : line.quantity;
      const number = amount(value, 0, line.quantity);
      if (number === null) return bad(res, `For ${line.itemName}, give 0 to ${qtyText(line.quantity)} ${line.unit}.`);

      if (number > 0) {
        const item = await StockItem.findById(line.item).lean();
        if (!item) return bad(res, `${line.itemName} no longer exists. Give 0 for it.`, 404);
        if (number > item.quantity) {
          return bad(res, `Only ${qtyText(item.quantity)} ${item.unit} of ${item.name} ${item.quantity === 1 ? "is" : "are"} in stock.`, 409);
        }
      }

      issued.push(number);
    }

    if (issued.every((number) => number === 0)) return bad(res, "Nothing to give? Turn the request down instead, and say why.");

    // claim it first, so it can't be issued twice
    const claimed = await SupplyRequest.findOneAndUpdate(
      { _id: request._id, status: "waiting" },
      {
        $set: {
          status: "issued",
          issuedById: req.admin._id,
          issuedByName: req.admin.name,
          issuedAt: new Date(),
          issueNote: note,
        },
      },
      { returnDocument: "after" }
    );

    if (!claimed) return bad(res, "This request has already been handled.", 409);

    const day = parseDay(innToday());
    const problems = [];

    for (let i = 0; i < claimed.lines.length; i += 1) {
      const line = claimed.lines[i];
      let given = issued[i];

      if (given > 0) {
        const result = await changeStock({
          itemId: line.item,
          type: "out",
          quantity: given,
          change: -given,
          person: req.admin,
          day,
          note: `Request ${claimed.ref} from ${claimed.requestedByName}`,
          department: claimed.department,
          ref: claimed.ref,
        });

        if (result.error) {
          problems.push(`${line.itemName}: ${result.error}`);
          given = 0;
        }
      }

      line.issued = given;
    }

    if (claimed.lines.every((line) => line.issued === 0)) {
      claimed.status = "waiting";
      claimed.issuedById = undefined;
      claimed.issuedByName = "";
      claimed.issuedAt = undefined;
      claimed.lines.forEach((line) => {
        line.issued = null;
      });
      await claimed.save();
      return bad(res, problems.join(" ") || "Nothing could be issued.", 409);
    }

    await claimed.save();

    await audit(
      req.admin,
      "requests",
      `Issued ${claimed.ref} to ${claimed.department} (${claimed.requestedByName}): ${linesText(claimed.lines, "issued")}`
    );

    return res.json({ success: true, request: requestForAdmin(claimed.toObject(), req), problems });
  } catch (error) {
    return serverError(res, "Issuing a request failed", error);
  }
});

router.post("/:id/reject", requirePermission("requests.manage"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Unknown request.");

    const reason = text((req.body || {}).reason);
    if (reason.length > 200) return bad(res, "The reason can be up to 200 characters.");

    const request = await SupplyRequest.findOneAndUpdate(
      { _id: req.params.id, status: "waiting" },
      { $set: { status: "rejected", rejectReason: reason, issuedById: req.admin._id, issuedByName: req.admin.name, issuedAt: new Date() } },
      { returnDocument: "after" }
    ).lean();

    if (!request) return bad(res, "This request has already been handled.", 409);

    await audit(req.admin, "requests", `Turned down ${request.ref} from ${request.requestedByName}` + (reason ? `: ${reason}` : ""));
    return res.json({ success: true, request: requestForAdmin(request, req) });
  } catch (error) {
    return serverError(res, "Turning down a request failed", error);
  }
});

router.post("/:id/received", requireAny("requests.make", "requests.manage"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Unknown request.");

    const request = await SupplyRequest.findById(req.params.id).lean();
    if (!request) return bad(res, "Request not found.", 404);
    if (!isMine(req, request)) return denied(res, "Only the person who asked can confirm they received it.");

    const updated = await SupplyRequest.findOneAndUpdate(
      { _id: request._id, status: "issued" },
      { $set: { status: "received", receivedAt: new Date() } },
      { returnDocument: "after" }
    ).lean();

    if (!updated) return bad(res, "This request isn't waiting to be confirmed.", 409);

    await audit(req.admin, "requests", `Confirmed receiving ${request.ref}: ${linesText(updated.lines, "issued")}`);
    return res.json({ success: true, request: requestForAdmin(updated, req) });
  } catch (error) {
    return serverError(res, "Confirming a request failed", error);
  }
});

module.exports = router;
