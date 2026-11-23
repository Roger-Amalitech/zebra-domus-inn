/* =========================================
   ZEBRA DOMUS INN
   Event bookings in the dashboard, mounted at /api/admin/events

   GET    /                 ?show=waiting|upcoming|past   events, prices, counts   (bookings.view)
   POST   /                 a phone or walk-in booking, confirmed at once         (bookings.manage)
                            { type, day, startTime, endTime, people, name, phone,
                              email?, organisation?, note?, source: phone|walk-in }
   POST   /:id/confirm      waiting -> confirmed (refused if the day is taken)    (bookings.manage)
   POST   /:id/decline      { reason? } waiting -> declined                       (bookings.manage)
   POST   /:id/cancel       { reason? } confirmed -> cancelled, frees the day     (bookings.manage)
   POST   /:id/paid         { paid: true|false }                                  (bookings.manage)
   PATCH  /types/:key       { price?, open? } the owner sets prices               (rooms.manage)

   One event per day in total. Every change goes to the audit log.
========================================= */

const express = require("express");
const mongoose = require("mongoose");

const EventBooking = require("../models/EventBooking");
const EventType = require("../models/EventType");
const { requirePermission } = require("../utils/permissions");
const { audit } = require("../utils/audit");
const { nextRef, money } = require("../utils/stockOps");
const { parseDay, toDay, innToday } = require("../utils/availability");
const { eventTypes, readEvent, dayTaken, TYPE_KEYS, typeName } = require("../utils/events");
const { METHODS, METHOD_NAMES, recordMoneyIn, voidMoneyIn } = require("../utils/money");

const router = express.Router();

const seeEvents = requirePermission("bookings.view");
const changeEvents = requirePermission("bookings.manage");
const changePrices = requirePermission("rooms.manage");

const SHOW = ["waiting", "upcoming", "past"];

function bad(res, message, status = 400, extra = {}) {
  return res.status(status).json({ success: false, message, ...extra });
}

function serverError(res, label, error) {
  console.error(`${label}:`, error.message);
  return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
}

function rwf(value) {
  return `RWF ${Math.round(value).toLocaleString("en-US")}`;
}

function dayWords(day) {
  return new Date(day).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/* `prices` (optional): today's price of each kind of event, for requests
   that came in before the owner set one */
function eventForAdmin(event, takenDays, prices) {
  const day = toDay(event.day);
  let price = event.price === undefined ? null : event.price;
  if (price === null && event.status === "waiting" && prices && prices[event.type]) price = prices[event.type];
  return {
    _id: event._id,
    ref: event.ref,
    type: event.type,
    typeName: event.typeName,
    day,
    startTime: event.startTime,
    endTime: event.endTime,
    people: event.people,
    name: event.name,
    phone: event.phone,
    email: event.email || "",
    organisation: event.organisation || "",
    note: event.note || "",
    price,
    paid: Boolean(event.paid),
    status: event.status,
    source: event.source,
    createdByName: event.createdByName || "",
    handledByName: event.handledByName || "",
    handledAt: event.handledAt || null,
    reason: event.reason || "",
    createdAt: event.createdAt,
    // a waiting request whose day another event already has
    dayTaken: event.status === "waiting" && Boolean(takenDays && takenDays.has(day)),
  };
}

async function confirmedDays(days) {
  const confirmed = await EventBooking.find({ status: "confirmed", day: { $in: days } }).select("day").lean();
  return new Set(confirmed.map((e) => toDay(e.day)));
}

function short(event) {
  return `${event.ref} ${event.typeName} on ${dayWords(event.day)} for ${event.name}`;
}

/* ---------- The list ---------- */

router.get("/", seeEvents, async (req, res) => {
  try {
    const show = SHOW.includes(req.query.show) ? req.query.show : "waiting";
    const today = parseDay(innToday());

    let filter;
    let sort;
    if (show === "waiting") {
      filter = { status: "waiting", day: { $gte: today } };
      sort = { day: 1, createdAt: 1 };
    } else if (show === "upcoming") {
      filter = { status: "confirmed", day: { $gte: today } };
      sort = { day: 1 };
    } else {
      // past events, and anything turned down, cancelled or never answered
      filter = {
        $or: [{ day: { $lt: today } }, { status: { $in: ["declined", "cancelled"] } }],
      };
      sort = { day: -1, createdAt: -1 };
    }

    const [events, waiting, upcoming, types] = await Promise.all([
      EventBooking.find(filter).sort(sort).limit(300).lean(),
      EventBooking.countDocuments({ status: "waiting", day: { $gte: today } }),
      EventBooking.countDocuments({ status: "confirmed", day: { $gte: today } }),
      eventTypes(),
    ]);

    const taken = await confirmedDays(events.filter((e) => e.status === "waiting").map((e) => e.day));
    const prices = Object.fromEntries(types.map((t) => [t.key, t.price]));

    return res.json({
      success: true,
      show,
      today: innToday(),
      counts: { waiting, upcoming },
      types,
      events: events.map((event) => eventForAdmin(event, taken, prices)),
    });
  } catch (error) {
    return serverError(res, "Event list failed", error);
  }
});

/* ---------- A phone or walk-in booking ---------- */

router.post("/", changeEvents, async (req, res) => {
  try {
    const read = readEvent(req.body, { staff: true });
    if (read.error) return bad(res, read.error);
    const v = read.values;

    const source = ["phone", "walk-in"].includes(req.body.source) ? req.body.source : "";
    if (!source) return bad(res, "How did they book: by phone or at the inn?");

    if (await dayTaken(v.day)) {
      return bad(res, `${dayWords(v.day)} already has an event. One event per day.`, 409, { code: "DAY_TAKEN" });
    }

    const type = (await eventTypes()).find((t) => t.key === v.type);

    let event;
    try {
      event = await EventBooking.create({
        ref: await nextRef("E"),
        type: v.type,
        typeName: v.typeName,
        day: v.day,
        startTime: v.startTime,
        endTime: v.endTime,
        people: v.people,
        name: v.name,
        phone: v.phone,
        email: v.email,
        organisation: v.organisation,
        note: v.note,
        price: type.price,
        status: "confirmed",
        source,
        createdByName: req.admin.name,
        handledByName: req.admin.name,
        handledAt: new Date(),
      });
    } catch (error) {
      if (error.code === 11000) {
        return bad(res, `${dayWords(v.day)} already has an event. One event per day.`, 409, { code: "DAY_TAKEN" });
      }
      throw error;
    }

    await audit(req.admin, "events", `Added ${source} booking ${short(event)} (${v.people} people), confirmed`);
    return res.status(201).json({ success: true, event: eventForAdmin(event.toObject()) });
  } catch (error) {
    return serverError(res, "Adding an event failed", error);
  }
});

/* ---------- Confirm, turn down, cancel, paid ---------- */

async function findEvent(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    bad(res, "Unknown event.");
    return null;
  }
  const event = await EventBooking.findById(req.params.id).lean();
  if (!event) bad(res, "Event not found.", 404);
  return event;
}

function reasonFrom(req) {
  const reason = typeof (req.body || {}).reason === "string" ? req.body.reason.trim() : "";
  return reason.slice(0, 200);
}

router.post("/:id/confirm", changeEvents, async (req, res) => {
  try {
    const event = await findEvent(req, res);
    if (!event) return undefined;
    if (event.status !== "waiting") return bad(res, "This request has already been answered.", 409);

    if (await dayTaken(event.day, event._id)) {
      return bad(res, `${dayWords(event.day)} already has a confirmed event. Turn this request down or agree another day with them.`, 409, {
        code: "DAY_TAKEN",
      });
    }

    // no price yet (asked before the owner set one): today's price
    const set = { status: "confirmed", handledByName: req.admin.name, handledAt: new Date() };
    if (event.price === null || event.price === undefined) {
      const type = (await eventTypes()).find((t) => t.key === event.type);
      if (type && type.price) set.price = type.price;
    }

    let updated;
    try {
      updated = await EventBooking.findOneAndUpdate(
        { _id: event._id, status: "waiting" },
        { $set: set },
        { returnDocument: "after" }
      ).lean();
    } catch (error) {
      if (error.code === 11000) {
        return bad(res, `${dayWords(event.day)} already has a confirmed event.`, 409, { code: "DAY_TAKEN" });
      }
      throw error;
    }

    if (!updated) return bad(res, "This request has already been answered.", 409);

    await audit(req.admin, "events", `Confirmed ${short(updated)}`);
    return res.json({ success: true, event: eventForAdmin(updated) });
  } catch (error) {
    return serverError(res, "Confirming an event failed", error);
  }
});

router.post("/:id/decline", changeEvents, async (req, res) => {
  try {
    const event = await findEvent(req, res);
    if (!event) return undefined;
    const reason = reasonFrom(req);

    const updated = await EventBooking.findOneAndUpdate(
      { _id: event._id, status: "waiting" },
      { $set: { status: "declined", reason, handledByName: req.admin.name, handledAt: new Date() } },
      { returnDocument: "after" }
    ).lean();

    if (!updated) return bad(res, "This request has already been answered.", 409);

    await audit(req.admin, "events", `Turned down ${short(updated)}` + (reason ? `: ${reason}` : ""));
    return res.json({ success: true, event: eventForAdmin(updated) });
  } catch (error) {
    return serverError(res, "Turning down an event failed", error);
  }
});

router.post("/:id/cancel", changeEvents, async (req, res) => {
  try {
    const event = await findEvent(req, res);
    if (!event) return undefined;
    const reason = reasonFrom(req);

    const updated = await EventBooking.findOneAndUpdate(
      { _id: event._id, status: "confirmed" },
      { $set: { status: "cancelled", reason, handledByName: req.admin.name, handledAt: new Date() } },
      { returnDocument: "after" }
    ).lean();

    if (!updated) return bad(res, "Only a confirmed event can be cancelled.", 409);

    await audit(req.admin, "events", `Cancelled ${short(updated)}` + (reason ? `: ${reason}` : "") + "; the day is free again");
    return res.json({ success: true, event: eventForAdmin(updated) });
  } catch (error) {
    return serverError(res, "Cancelling an event failed", error);
  }
});

router.post("/:id/paid", changeEvents, async (req, res) => {
  try {
    const event = await findEvent(req, res);
    if (!event) return undefined;
    const body = req.body || {};
    if (typeof body.paid !== "boolean") return bad(res, "Say whether it is paid.");
    const paid = body.paid;

    // marked paid: how much, how and when (by default the event's price, cash, today)
    let received = null;
    if (paid && !event.paid) {
      const method = body.paidWith === undefined || body.paidWith === "" ? "cash" : body.paidWith;
      if (!METHODS.includes(method)) return bad(res, "Choose how they paid.");
      const amountPaid = body.paidAmount === undefined || body.paidAmount === "" ? event.price : money(body.paidAmount);
      if (!amountPaid || amountPaid < 1) return bad(res, "Write how much they paid, in RWF (a whole number).");
      const today = innToday();
      const dayText = body.paidDay || today;
      const paidDay = parseDay(dayText);
      if (!paidDay || dayText > today) return bad(res, "The day they paid can't be in the future.");
      received = { method, amount: amountPaid, day: paidDay };
    }

    const updated = await EventBooking.findOneAndUpdate(
      { _id: event._id, status: "confirmed" },
      { $set: { paid } },
      { returnDocument: "after" }
    ).lean();

    if (!updated) return bad(res, "Only a confirmed event can be marked as paid.", 409);

    let said = `Marked ${short(updated)} as ${paid ? "paid" : "not paid"}`;
    if (received) {
      await recordMoneyIn({
        person: req.admin,
        amount: received.amount,
        day: received.day,
        method: received.method,
        source: "event",
        sourceId: updated._id,
        sourceRef: updated.ref,
        income: "events",
        description: `${updated.typeName}, event ${updated.ref}`,
        customerName: updated.name,
      });
      said += `: RWF ${received.amount.toLocaleString("en-US")} by ${METHOD_NAMES[received.method]}`;
    }
    if (!paid && event.paid) {
      const taken = await voidMoneyIn({ source: "event", sourceId: updated._id }, req.admin, "Marked as not paid");
      if (taken.length) said += `; money in ${taken.map((e) => e.ref).join(", ")} taken back`;
    }
    await audit(req.admin, "events", said);
    return res.json({ success: true, event: eventForAdmin(updated) });
  } catch (error) {
    return serverError(res, "Marking an event paid failed", error);
  }
});

/* ---------- Prices (owner) ---------- */

router.patch("/types/:key", changePrices, async (req, res) => {
  try {
    const key = req.params.key;
    if (!TYPE_KEYS.includes(key)) return bad(res, "Unknown event.", 404);

    const body = req.body || {};
    const set = {};

    if (body.price !== undefined) {
      if (body.price === null || body.price === "") set.price = null;
      else {
        const price = money(body.price);
        if (price === null || price < 1) return bad(res, "Enter the price as a whole number of RWF, or leave it empty.");
        set.price = price;
      }
    }
    if (body.open !== undefined) {
      if (typeof body.open !== "boolean") return bad(res, "Say whether the website takes requests.");
      set.open = body.open;
    }
    if (!Object.keys(set).length) return bad(res, "Nothing to change.");

    await eventTypes(); // make sure it exists
    const before = await EventType.findOne({ key }).lean();
    await EventType.updateOne({ key }, { $set: set });

    const said = [];
    if ("price" in set && set.price !== before.price) {
      said.push(set.price === null ? "price removed" : `price ${rwf(set.price)}` + (before.price ? ` (was ${rwf(before.price)})` : ""));
    }
    if ("open" in set && set.open !== (before.open !== false)) said.push(set.open ? "website requests on" : "website requests off");
    if (said.length) await audit(req.admin, "events", `${typeName(key)}: ${said.join(", ")}`);

    return res.json({ success: true, types: await eventTypes() });
  } catch (error) {
    return serverError(res, "Changing an event price failed", error);
  }
});

module.exports = router;
