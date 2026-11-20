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
const { toDay } = require("../utils/availability");
const { eventTypes, bookableDays, takenDays, readEvent, dayTaken, TIMES, MAX_PEOPLE } = require("../utils/events");

const router = express.Router();

/* A few requests an hour from one place is plenty; more is a robot. */
const LIMIT = 8;
const WINDOW_MS = 60 * 60 * 1000;
const recent = new Map();

function tooMany(ip) {
  const now = Date.now();
  const times = (recent.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= LIMIT) {
    recent.set(ip, times);
    return true;
  }
  times.push(now);
  recent.set(ip, times);
  if (recent.size > 5000) recent.clear(); // never let it grow without end
  return false;
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
    const read = readEvent(req.body);
    if (read.error) return bad(res, read.error);
    const v = read.values;

    const type = (await eventTypes()).find((t) => t.key === v.type);
    if (!type.open) return bad(res, `${type.name} bookings are closed for now. Please call the inn.`, 409, { code: "TYPE_CLOSED" });

    if (await dayTaken(v.day)) {
      return bad(res, "That day already has an event. Please choose another day.", 409, { code: "DAY_TAKEN" });
    }

    if (tooMany(req.ip)) return bad(res, "Too many requests. Please call the inn instead.", 429);

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
