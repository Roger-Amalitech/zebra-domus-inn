/* =========================================
   ZEBRA DORMUS INN
   Events guests can book: house parties and swimming competitions.

   - Each kind of event has one fixed price, set by the owner in the
     dashboard (EventType). Until it is set the website says the inn will
     tell the price.
   - One event per day in total: a confirmed event blocks the whole day.
     Requests wait for the owner or manager to confirm them.
========================================= */

const EventType = require("../models/EventType");
const EventBooking = require("../models/EventBooking");
const { parseDay, toDay, addDays, innToday } = require("./availability");

const EVENT_TYPES = [
  { key: "house-party", name: "House party" },
  { key: "swimming-competition", name: "Swimming competition" },
];

const TYPE_KEYS = EVENT_TYPES.map((type) => type.key);
const MAX_PEOPLE = 1000;
const DAYS_AHEAD = 365;

// times people can choose: 06:00, 06:30 ... 23:30
const TIMES = [];
for (let hour = 6; hour <= 23; hour += 1) {
  TIMES.push(`${String(hour).padStart(2, "0")}:00`, `${String(hour).padStart(2, "0")}:30`);
}

function typeName(key) {
  const type = EVENT_TYPES.find((t) => t.key === key);
  return type ? type.name : key;
}

/* Every kind of event with its price and whether the website takes
   requests for it. Missing ones are created (no price yet, open). */
async function eventTypes() {
  const saved = await EventType.find({ key: { $in: TYPE_KEYS } }).lean();

  const missing = TYPE_KEYS.filter((key) => !saved.some((t) => t.key === key));
  if (missing.length) {
    await Promise.all(
      missing.map((key) =>
        EventType.updateOne({ key }, { $setOnInsert: { key, price: null, open: true } }, { upsert: true })
      )
    );
    return eventTypes();
  }

  return EVENT_TYPES.map((type) => {
    const row = saved.find((t) => t.key === type.key);
    return { key: type.key, name: type.name, price: row.price === undefined ? null : row.price, open: row.open !== false };
  });
}

// The first and last day a guest can ask for (from tomorrow, up to a year ahead).
function bookableDays() {
  const today = parseDay(innToday());
  return { first: toDay(addDays(today, 1)), last: toDay(addDays(today, DAYS_AHEAD)) };
}

// Days from today on that already have a confirmed event.
async function takenDays() {
  const events = await EventBooking.find({ status: "confirmed", day: { $gte: parseDay(innToday()) } })
    .select("day")
    .sort({ day: 1 })
    .lean();
  return events.map((event) => toDay(event.day));
}

/* The fields of an event request, checked. Returns { values } or { error }.
   `staff` relaxes the earliest day to today (a walk-in can book for today). */
function readEvent(body, { staff = false } = {}) {
  const b = body || {};
  const text = (value) => (typeof value === "string" ? value.trim() : "");

  const type = text(b.type);
  if (!TYPE_KEYS.includes(type)) return { error: "Please choose the event: house party or swimming competition." };

  const dayText = text(b.day);
  const day = parseDay(dayText);
  if (!day) return { error: "Please choose the day of the event." };

  const range = bookableDays();
  const first = staff ? innToday() : range.first;
  if (dayText < first) {
    return { error: staff ? "The day can't be in the past." : "Please choose a day from tomorrow on." };
  }
  if (dayText > range.last) return { error: "Events can be booked up to one year ahead." };

  const startTime = text(b.startTime);
  const endTime = text(b.endTime);
  if (!TIMES.includes(startTime) || !TIMES.includes(endTime)) {
    return { error: "Please choose when the event starts and ends (between 06:00 and 23:30)." };
  }
  if (endTime <= startTime) return { error: "The end time must be after the start time." };

  const people = Number(b.people);
  if (!Number.isInteger(people) || people < 1 || people > MAX_PEOPLE) {
    return { error: `Please enter how many people will come (1 to ${MAX_PEOPLE}).` };
  }

  const name = text(b.name);
  const phone = text(b.phone);
  const email = text(b.email).toLowerCase();
  const organisation = text(b.organisation);
  const note = text(b.note);

  if (!name) return { error: "Please enter your name." };
  if (name.length > 100 || organisation.length > 100) return { error: "The name can be up to 100 characters." };
  if ((phone.match(/\d/g) || []).length < 9 || phone.length > 30) return { error: "Please enter a phone number we can call." };
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return { error: "Please check the email address, or leave it empty." };
  }
  if (note.length > 500) return { error: "The note can be up to 500 characters." };

  return {
    values: { type, typeName: typeName(type), day, dayText, startTime, endTime, people, name, phone, email, organisation, note },
  };
}

// Has another event been confirmed for this day?
async function dayTaken(day, exceptId) {
  const filter = { status: "confirmed", day };
  if (exceptId) filter._id = { $ne: exceptId };
  return Boolean(await EventBooking.exists(filter));
}

module.exports = {
  EVENT_TYPES,
  TYPE_KEYS,
  TIMES,
  MAX_PEOPLE,
  typeName,
  eventTypes,
  bookableDays,
  takenDays,
  readEvent,
  dayTaken,
};
