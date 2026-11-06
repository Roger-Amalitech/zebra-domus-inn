/* =========================================
   ZEBRA DORMUS INN
   Admin API (everything except /login needs the admin token)

   POST  /api/admin/login              { email, password } -> { token, user }
   GET   /api/admin/me                 who is signed in
   POST  /api/admin/me/password        { currentPassword, newPassword }
   GET   /api/admin/summary            today's arrivals, departures, guests staying, waiting bookings
   GET   /api/admin/bookings           ?when=upcoming|past|all &status=all|pending|confirmed|cancelled &q=text
   PATCH /api/admin/bookings/:id       { bookingStatus?, paymentStatus? }
   GET   /api/admin/occupancy          ?from=YYYY-MM-DD &days=14  rooms booked per night
   GET   /api/admin/rooms              every room type, open or closed
   PATCH /api/admin/rooms/:id          { pricePerNight?, totalRooms?, capacity?, available?, description? }  (owner only)
         /api/admin/staff              staff accounts (owner only), see staffRoutes.js
========================================= */

const express = require("express");
const mongoose = require("mongoose");

const Room = require("../models/Room");
const Booking = require("../models/Booking");
const AdminUser = require("../models/AdminUser");
const staffRoutes = require("./staffRoutes");
const {
  login,
  requireAdmin,
  requireOwner,
  passwordMatches,
  passwordProblem,
  hashPassword,
  makeToken,
  publicUser,
  ownerEmailFromEnv,
} = require("../utils/adminAuth");
const {
  parseDay,
  toDay,
  addDays,
  innToday,
  availabilityForRooms,
} = require("../utils/availability");

const router = express.Router();

/* Admin answers hold guests' details: never let a browser or proxy keep a copy. */
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.post("/login", login);

router.use(requireAdmin);

router.use("/staff", requireOwner, staffRoutes);

const BOOKING_STATUSES = ["pending", "confirmed", "cancelled"];
const PAYMENT_STATUSES = ["pending", "paid", "failed"];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function bookingForAdmin(booking) {
  const room = booking.room && typeof booking.room === "object" ? booking.room : null;

  return {
    _id: booking._id,
    bookingReference: booking.bookingReference,
    guestName: booking.guestName,
    guestEmail: booking.guestEmail,
    guestPhone: booking.guestPhone,
    roomId: room ? room._id : booking.room,
    roomName: room ? room.name : "",
    checkIn: toDay(booking.checkIn),
    checkOut: toDay(booking.checkOut),
    nights: Math.round((booking.checkOut - booking.checkIn) / 86400000),
    guests: booking.guests,
    totalPrice: booking.totalPrice,
    paymentMethod: booking.paymentMethod,
    paymentStatus: booking.paymentStatus,
    bookingStatus: booking.bookingStatus,
    createdAt: booking.createdAt,
  };
}

function serverError(res, label, error) {
  console.error(`${label}:`, error.message);
  return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
}

/* ---------- The signed-in person ---------- */

router.get("/me", (req, res) => {
  res.json({ success: true, user: publicUser(req.admin) });
});

router.post("/me/password", async (req, res) => {
  try {
    const body = req.body || {};
    const user = await AdminUser.findById(req.admin._id);

    if (user.email === ownerEmailFromEnv()) {
      return res.status(400).json({
        success: false,
        message: "Your password is set in backend/.env. Change ADMIN_PASSWORD there and restart the server.",
      });
    }

    if (typeof body.currentPassword !== "string" || !(await passwordMatches(body.currentPassword, user.passwordHash))) {
      return res.status(400).json({ success: false, message: "Your current password isn't right." });
    }

    const weak = passwordProblem(body.newPassword);
    if (weak) {
      return res.status(400).json({ success: false, message: weak });
    }

    user.passwordHash = await hashPassword(body.newPassword);
    user.tokenVersion = (user.tokenVersion || 0) + 1; // signs out other devices
    await user.save();

    // A new token so this device stays signed in.
    return res.json({ success: true, token: makeToken(user), user: publicUser(user) });
  } catch (error) {
    return serverError(res, "Password change failed", error);
  }
});

/* ---------- Today ---------- */

router.get("/summary", async (req, res) => {
  try {
    const todayText = parseDay(req.query.date) ? req.query.date : innToday();
    const today = parseDay(todayText);
    const tomorrow = addDays(today, 1);
    const active = { bookingStatus: { $ne: "cancelled" } };

    const [arrivals, departures, staying, waiting, rooms] = await Promise.all([
      Booking.find({ ...active, checkIn: today }).populate("room", "name").sort({ guestName: 1 }).lean(),
      Booking.find({ ...active, checkOut: today }).populate("room", "name").sort({ guestName: 1 }).lean(),
      Booking.find({ ...active, checkIn: { $lte: today }, checkOut: { $gt: today } })
        .populate("room", "name")
        .sort({ checkOut: 1 })
        .lean(),
      Booking.countDocuments({ bookingStatus: "pending", checkOut: { $gt: today } }),
      Room.find().sort({ pricePerNight: 1 }).lean(),
    ]);

    const tonight = await availabilityForRooms(rooms, today, tomorrow);

    return res.json({
      success: true,
      date: todayText,
      arrivals: arrivals.map(bookingForAdmin),
      departures: departures.map(bookingForAdmin),
      staying: staying.map(bookingForAdmin),
      waitingForConfirmation: waiting,
      roomsTonight: rooms.map((room) => {
        const count = tonight.get(String(room._id));
        return {
          _id: room._id,
          name: room.name,
          totalRooms: room.totalRooms,
          booked: count.booked,
          free: room.totalRooms - count.booked,
          open: room.available !== false,
        };
      }),
    });
  } catch (error) {
    return serverError(res, "Admin summary failed", error);
  }
});

/* ---------- Bookings ---------- */

router.get("/bookings", async (req, res) => {
  try {
    const when = ["upcoming", "past", "all"].includes(req.query.when) ? req.query.when : "upcoming";
    const status = BOOKING_STATUSES.includes(req.query.status) ? req.query.status : "all";
    const search = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60) : "";
    const today = parseDay(innToday());

    const filter = {};

    if (when === "upcoming") filter.checkOut = { $gte: today };
    if (when === "past") filter.checkOut = { $lt: today };
    if (status !== "all") filter.bookingStatus = status;

    if (search) {
      const pattern = new RegExp(escapeRegex(search), "i");
      filter.$or = [
        { guestName: pattern },
        { guestEmail: pattern },
        { guestPhone: pattern },
        { bookingReference: pattern },
      ];
    }

    const bookings = await Booking.find(filter)
      .populate("room", "name")
      .sort(when === "past" ? { checkIn: -1 } : { checkIn: 1, createdAt: 1 })
      .limit(300)
      .lean();

    return res.json({ success: true, count: bookings.length, bookings: bookings.map(bookingForAdmin) });
  } catch (error) {
    return serverError(res, "Admin bookings list failed", error);
  }
});

router.patch("/bookings/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Unknown booking." });
    }

    const body = req.body || {};
    const changes = {};

    if (body.bookingStatus !== undefined) {
      if (!BOOKING_STATUSES.includes(body.bookingStatus)) {
        return res.status(400).json({ success: false, message: "Unknown booking status." });
      }
      changes.bookingStatus = body.bookingStatus;
    }

    if (body.paymentStatus !== undefined) {
      if (!PAYMENT_STATUSES.includes(body.paymentStatus)) {
        return res.status(400).json({ success: false, message: "Unknown payment status." });
      }
      changes.paymentStatus = body.paymentStatus;
    }

    if (!Object.keys(changes).length) {
      return res.status(400).json({ success: false, message: "Nothing to change." });
    }

    const booking = await Booking.findById(req.params.id).populate("room");

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    // Bringing back a cancelled booking needs a free room again.
    if (
      booking.bookingStatus === "cancelled" &&
      changes.bookingStatus &&
      changes.bookingStatus !== "cancelled" &&
      booking.room
    ) {
      const counts = await availabilityForRooms([booking.room], booking.checkIn, booking.checkOut, {
        excludeId: booking._id,
      });

      if (counts.get(String(booking.room._id)).available <= 0) {
        return res.status(409).json({
          success: false,
          message: `No ${booking.room.name} is free for these dates any more, so this booking can't be brought back.`,
        });
      }
    }

    Object.assign(booking, changes);
    await booking.save();

    return res.json({ success: true, booking: bookingForAdmin(booking.toObject()) });
  } catch (error) {
    return serverError(res, "Admin booking update failed", error);
  }
});

/* ---------- Rooms booked per night ---------- */

router.get("/occupancy", async (req, res) => {
  try {
    const fromText = parseDay(req.query.from) ? req.query.from : innToday();
    const from = parseDay(fromText);
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 1), 62);
    const to = addDays(from, days);

    const [rooms, bookings] = await Promise.all([
      Room.find().sort({ pricePerNight: 1 }).lean(),
      Booking.find({
        bookingStatus: { $ne: "cancelled" },
        checkIn: { $lt: to },
        checkOut: { $gt: from },
      })
        .select("room checkIn checkOut guestName bookingReference bookingStatus guests")
        .sort({ checkIn: 1 })
        .lean(),
    ]);

    const dates = [];
    for (let i = 0; i < days; i += 1) dates.push(toDay(addDays(from, i)));

    return res.json({
      success: true,
      from: fromText,
      days,
      dates,
      rooms: rooms.map((room) => ({
        _id: room._id,
        name: room.name,
        totalRooms: room.totalRooms,
        open: room.available !== false,
        nights: dates.map((day) => {
          const night = parseDay(day);
          const here = bookings.filter(
            (b) => String(b.room) === String(room._id) && b.checkIn <= night && b.checkOut > night
          );

          return {
            date: day,
            booked: here.length,
            free: room.totalRooms - here.length,
            guests: here.map((b) => ({
              _id: b._id,
              guestName: b.guestName,
              bookingReference: b.bookingReference,
              bookingStatus: b.bookingStatus,
              guests: b.guests,
              checkIn: toDay(b.checkIn),
              checkOut: toDay(b.checkOut),
            })),
          };
        }),
      })),
    });
  } catch (error) {
    return serverError(res, "Admin occupancy failed", error);
  }
});

/* ---------- Room types: price, number of rooms, open/closed ---------- */

router.get("/rooms", async (req, res) => {
  try {
    const rooms = await Room.find().sort({ pricePerNight: 1 }).lean();
    return res.json({ success: true, rooms });
  } catch (error) {
    return serverError(res, "Admin rooms list failed", error);
  }
});

router.patch("/rooms/:id", requireOwner, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Unknown room type." });
    }

    const body = req.body || {};
    const changes = {};
    const whole = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

    if (body.pricePerNight !== undefined) {
      const price = Number(body.pricePerNight);
      if (!whole(price, 0, 10000000)) {
        return res.status(400).json({ success: false, message: "Price must be a whole number of RWF." });
      }
      changes.pricePerNight = price;
    }

    if (body.totalRooms !== undefined) {
      const total = Number(body.totalRooms);
      if (!whole(total, 1, 500)) {
        return res.status(400).json({ success: false, message: "Number of rooms must be between 1 and 500." });
      }
      changes.totalRooms = total;
    }

    if (body.capacity !== undefined) {
      const capacity = Number(body.capacity);
      if (!whole(capacity, 1, 20)) {
        return res.status(400).json({ success: false, message: "Guests per room must be between 1 and 20." });
      }
      changes.capacity = capacity;
    }

    if (body.available !== undefined) {
      if (typeof body.available !== "boolean") {
        return res.status(400).json({ success: false, message: "Open for booking must be yes or no." });
      }
      changes.available = body.available;
    }

    if (body.description !== undefined) {
      if (typeof body.description !== "string" || body.description.length > 500) {
        return res.status(400).json({ success: false, message: "Description can be up to 500 characters." });
      }
      changes.description = body.description.trim();
    }

    if (!Object.keys(changes).length) {
      return res.status(400).json({ success: false, message: "Nothing to change." });
    }

    const room = await Room.findByIdAndUpdate(req.params.id, { $set: changes }, {
      returnDocument: "after",
      runValidators: true,
    }).lean();

    if (!room) {
      return res.status(404).json({ success: false, message: "Room type not found." });
    }

    return res.json({ success: true, room });
  } catch (error) {
    return serverError(res, "Admin room update failed", error);
  }
});

module.exports = router;
