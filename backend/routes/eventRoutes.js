/* =========================================
   ZEBRA DORMUS INN
   Event requests from the website, mounted at /api/events

   GET   /     the events with their prices, and the days already taken
   POST  /     { type, day, startTime, endTime, people, name, phone, email?, organisation?, note? }
               saved as "waiting": the owner or manager confirms it by phone
========================================= */

const express = require("express");

const EventBooking = require("../models/EventBooking");
const { nextRef } = require("../utils/stockOps");
const { toDay, parseDay, innToday } = require("../utils/availability");
const { eventTypes, bookableDays, takenDays, readEvent, dayTaken, TIMES, MAX_PEOPLE } = require("../utils/events");
const { makeLimit, filledTrap, phoneKey } = require("../utils/limits");

const router = express.Router();

/* A few requests an hour from one place is plenty; more is a robot.
   One guest (phone or email) can have only two requests waiting at once. */
const perHour = makeLimit(8, 60 * 60 * 1000);
const WAITING_PER_GUEST = 2;

async function waitingFor(phone, email) {
  const key = phoneKey(phone);
  const waiting = await EventBooking.find({ status: "waiting", day: { $gte: parseDay(innToday()) } }).select("phone email").lean();
  return waiting.filter((event) => (key.length === 9 && phoneKey(event.phone) === key) || (email && event.email === email)).length;
}

function bad(res, message, status = 400, extra = {}) {
  return res.status(status).json({ success: false, message, ...extra });
}

router.get("/", async (req, res) => {
  try {
    const [types, taken] = await Promise.all([eventTypes(), takenDays()]);
    const range = bookableDays();

    return res.json({
      success: true,
      types: types.map((type) => ({ key: type.key, price: type.price, open: type.open })),
      takenDays: taken,
      firstDay: range.first,
      lastDay: range.last,
      times: TIMES,
      maxPeople: MAX_PEOPLE,
    });
  } catch (error) {
    console.error("Event list failed:", error.message);
    return bad(res, "Something went wrong. Please try again.", 500);
  }
});

router.post("/", async (req, res) => {
  try {
    if (filledTrap(req.body)) {
      console.warn("Event request turned away: the hidden form field was filled in.");
      return bad(res, "Please refresh the page and try again.");
    }

    const read = readEvent(req.body);
    if (read.error) return bad(res, read.error);
    const v = read.values;

    const type = (await eventTypes()).find((t) => t.key === v.type);
    if (!type.open) return bad(res, `${type.name} bookings are closed for now. Please call the inn.`, 409, { code: "TYPE_CLOSED" });

    if (await dayTaken(v.day)) {
      return bad(res, "That day already has an event. Please choose another day.", 409, { code: "DAY_TAKEN" });
    }

    if (perHour.full(req.ip)) return bad(res, "Too many requests. Please call the inn instead.", 429);
    perHour.add(req.ip);

    if ((await waitingFor(v.phone, v.email)) >= WAITING_PER_GUEST) {
      return bad(res, `You already have ${WAITING_PER_GUEST} event requests waiting for the inn. Please wait for the inn to call you, or call us.`, 429, { code: "TOO_MANY_WAITING" });
    }

    const event = await EventBooking.create({
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
      status: "waiting",
      source: "website",
    });

    return res.status(201).json({
      success: true,
      event: {
        ref: event.ref,
        type: event.type,
        day: toDay(event.day),
        startTime: event.startTime,
        endTime: event.endTime,
        people: event.people,
        name: event.name,
        price: event.price,
        status: event.status,
      },
    });
  } catch (error) {
    console.error("Event request failed:", error.message);
    return bad(res, "We couldn't send your request. Please try again.", 500);
  }
});

module.exports = router;
