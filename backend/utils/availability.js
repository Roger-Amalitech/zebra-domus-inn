/* =========================================
   ZEBRA DORMUS INN
   Room availability: how many rooms of each type
   are free for a stay, counted night by night.
========================================= */

const Booking = require("../models/Booking");

const DAY_MS = 24 * 60 * 60 * 1000;

/* Read "YYYY-MM-DD" as midnight UTC (the way bookings are stored).
   Returns null for anything that isn't a real date. */
function parseDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return null;
  }

  return date;
}

function toDay(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

function nightsBetween(checkIn, checkOut) {
  return Math.round((checkOut.getTime() - checkIn.getTime()) / DAY_MS);
}

/* Today's date at the inn (Rwanda time), as "YYYY-MM-DD". */
function innToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kigali",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/* Bookings that hold a room (anything not cancelled) and overlap the stay.
   options.excludeId: leave this booking out (e.g. the one being checked).
   options.beforeId: only count bookings made before this one. */
function activeOverlapping(roomIds, checkIn, checkOut, options = {}) {
  const filter = {
    room: { $in: roomIds },
    bookingStatus: { $ne: "cancelled" },
    checkIn: { $lt: checkOut },
    checkOut: { $gt: checkIn },
  };

  if (options.excludeId || options.beforeId) {
    filter._id = {};
    if (options.excludeId) filter._id.$ne = options.excludeId;
    if (options.beforeId) filter._id.$lt = options.beforeId;
  }

  return Booking.find(filter).select("room checkIn checkOut").lean();
}

/* For each room type, the busiest night decides how many rooms are free
   for the whole stay. Two short bookings on different nights only take
   one room between them, so we count night by night. */
async function availabilityForRooms(rooms, checkIn, checkOut, options = {}) {
  const nights = nightsBetween(checkIn, checkOut);
  const bookings = await activeOverlapping(
    rooms.map((room) => room._id),
    checkIn,
    checkOut,
    options
  );

  const result = new Map();

  rooms.forEach((room) => {
    const perNight = new Array(nights).fill(0);

    bookings
      .filter((booking) => String(booking.room) === String(room._id))
      .forEach((booking) => {
        for (let i = 0; i < nights; i += 1) {
          const night = addDays(checkIn, i);

          if (booking.checkIn <= night && booking.checkOut > night) {
            perNight[i] += 1;
          }
        }
      });

    const booked = perNight.length ? Math.max(...perNight) : 0;
    const total = Number(room.totalRooms) || 0;
    const open = room.available !== false;

    result.set(String(room._id), {
      totalRooms: total,
      booked,
      available: open ? Math.max(0, total - booked) : 0,
      open,
    });
  });

  return result;
}

module.exports = {
  DAY_MS,
  parseDay,
  toDay,
  addDays,
  nightsBetween,
  innToday,
  availabilityForRooms,
};
