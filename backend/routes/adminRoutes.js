/* =========================================
   ZEBRA DORMUS INN
   Admin API (everything except /login needs the admin token)

   POST  /api/admin/login              { email, password } -> { token, user },
                                       or { step: "code" | "setup", ticket } when two-step sign-in comes next
   POST  /api/admin/login/code         { ticket, code } -> { token, user }   (6-digit code or a backup code)
   POST  /api/admin/login/setup        { ticket } -> { secret, link }       (owner setting it up at sign-in)
   POST  /api/admin/login/setup/confirm { ticket, code } -> { token, user, backupCodes }
   GET   /api/admin/me                 who is signed in
   POST  /api/admin/me/password        { currentPassword, newPassword }
   POST  /api/admin/me/two-step/start  -> { secret, link }       turn on two-step sign-in
   POST  /api/admin/me/two-step/confirm { code } -> { backupCodes }
   POST  /api/admin/me/two-step/off    { password }               (not for the owner: required)
   POST  /api/admin/me/two-step/backup-codes { code } -> { backupCodes }   new ones, the old ones stop working
   GET   /api/admin/summary            today's arrivals, departures, guests staying, waiting bookings, events
   GET   /api/admin/bookings           ?when=upcoming|past|all &status=all|pending|confirmed|cancelled &q=text
   PATCH /api/admin/bookings/:id       { bookingStatus?, paymentStatus? }
   GET   /api/admin/occupancy          ?from=YYYY-MM-DD &days=14  rooms booked per night
   GET   /api/admin/rooms              every room type, open or closed
   PATCH /api/admin/rooms/:id          { pricePerNight?, totalRooms?, capacity?, available?, description? }
         /api/admin/staff              user accounts (owner and managers), see staffRoutes.js
         /api/admin/stock              store room: items, issues, counts, budgets (stockRoutes.js)
         /api/admin/purchases          what the owner bought; the manager checks it in (purchaseRoutes.js)
         /api/admin/requests           staff ask for supplies; the manager issues them (requestRoutes.js)
         /api/admin/audit              who did what (owner), see auditRoutes.js
         /api/admin/events             house parties and swimming competitions (adminEventRoutes.js)

   What each role may do is checked on every request (utils/permissions.js).
   Every change is written to the audit log (utils/audit.js).
========================================= */

const express = require("express");
const mongoose = require("mongoose");

const Room = require("../models/Room");
const Booking = require("../models/Booking");
const EventBooking = require("../models/EventBooking");
const AdminUser = require("../models/AdminUser");
const staffRoutes = require("./staffRoutes");
const stockRoutes = require("./stockRoutes");
const purchaseRoutes = require("./purchaseRoutes");
const requestRoutes = require("./requestRoutes");
const auditRoutes = require("./auditRoutes");
const adminEventRoutes = require("./adminEventRoutes");
const { audit } = require("../utils/audit");
const {
  login,
  loginCode,
  loginSetupStart,
  loginSetupConfirm,
  startTwoStep,
  confirmTwoStep,
  clearTwoStep,
  newBackupCodesFor,
  backupCodesLeft,
  withSecrets,
  twoStepRequired,
  requireAdmin,
  passwordMatches,
  passwordProblem,
  hashPassword,
  makeToken,
  publicUser,
  ownerEmailFromEnv,
} = require("../utils/adminAuth");
const { requirePermission, requireManager } = require("../utils/permissions");
const totp = require("../utils/totp");
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
router.post("/login/code", loginCode);
router.post("/login/setup", loginSetupStart);
router.post("/login/setup/confirm", loginSetupConfirm);

router.use(requireAdmin);

router.use("/staff", requireManager, staffRoutes);
router.use("/stock", stockRoutes);
router.use("/purchases", purchaseRoutes);
router.use("/requests", requestRoutes);
router.use("/audit", requirePermission("audit.view"), auditRoutes);
router.use("/events", adminEventRoutes);

const seeBookings = requirePermission("bookings.view");
const changeBookings = requirePermission("bookings.manage");
const changeRooms = requirePermission("rooms.manage");

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

router.get("/me", async (req, res) => {
  try {
    const left = req.admin.twoStepOn ? await backupCodesLeft(req.admin._id) : 0;
    return res.json({ success: true, user: publicUser(req.admin), backupCodesLeft: left });
  } catch (error) {
    return serverError(res, "Account check failed", error);
  }
});

/* ---------- Two-step sign-in, from My account ---------- */

router.post("/me/two-step/start", async (req, res) => {
  try {
    if (req.admin.twoStepOn) {
      return res.status(409).json({ success: false, message: "Two-step sign-in is already on." });
    }
    return res.json({ success: true, ...(await startTwoStep(req.admin)) });
  } catch (error) {
    return serverError(res, "Two-step setup failed", error);
  }
});

router.post("/me/two-step/confirm", async (req, res) => {
  try {
    const done = await confirmTwoStep(req.admin._id, (req.body || {}).code);
    if (done.why) return res.status(400).json({ success: false, message: done.why });
    return res.json({ success: true, user: publicUser(done.user), backupCodes: done.codes });
  } catch (error) {
    return serverError(res, "Two-step setup failed", error);
  }
});

router.post("/me/two-step/off", async (req, res) => {
  try {
    if (twoStepRequired(req.admin)) {
      return res.status(403).json({ success: false, message: "The owner's account must use two-step sign-in." });
    }
    const user = await AdminUser.findById(req.admin._id);
    const password = (req.body || {}).password;
    if (typeof password !== "string" || !(await passwordMatches(password, user.passwordHash))) {
      return res.status(400).json({ success: false, message: "Your password isn't right." });
    }
    await clearTwoStep(user._id);
    await audit(user, "sign-in", "Turned off two-step sign-in");
    user.twoStepOn = false;
    return res.json({ success: true, user: publicUser(user) });
  } catch (error) {
    return serverError(res, "Turning off two-step sign-in failed", error);
  }
});

/* New backup codes need a code from the app (not a backup code). */
router.post("/me/two-step/backup-codes", async (req, res) => {
  try {
    const user = await withSecrets(req.admin._id);
    if (!user.twoStepOn) return res.status(400).json({ success: false, message: "Two-step sign-in is off." });

    const step = totp.checkCode(user.totpSecret, (req.body || {}).code, user.totpLastStep || 0);
    if (!step) {
      return res.status(400).json({ success: false, message: "That code isn't right. Type the newest 6-digit code from the app." });
    }
    user.totpLastStep = step;
    await user.save();
    return res.json({ success: true, backupCodes: await newBackupCodesFor(user) });
  } catch (error) {
    return serverError(res, "New backup codes failed", error);
  }
});

router.post("/me/password", async (req, res) => {
  try {
    const body = req.body || {};
    const user = await AdminUser.findById(req.admin._id);

    if (user.email === ownerEmailFromEnv()) {
      return res.status(400).json({
        success: false,
        message: "Your password is set on the server (ADMIN_PASSWORD on Render). Change it there and deploy again.",
      });
    }

    if (typeof body.currentPassword !== "string" || !(await passwordMatches(body.currentPassword, user.passwordHash))) {
      return res.status(400).json({ success: false, message: "Your current password isn't right." });
    }

    const weak = passwordProblem(body.newPassword, user);
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

router.get("/summary", seeBookings, async (req, res) => {
  try {
    const todayText = parseDay(req.query.date) ? req.query.date : innToday();
    const today = parseDay(todayText);
    const tomorrow = addDays(today, 1);
    const active = { bookingStatus: { $ne: "cancelled" } };

    const [arrivals, departures, staying, waiting, rooms, eventsToday, eventsWaiting] = await Promise.all([
      Booking.find({ ...active, checkIn: today }).populate("room", "name").sort({ guestName: 1 }).lean(),
      Booking.find({ ...active, checkOut: today }).populate("room", "name").sort({ guestName: 1 }).lean(),
      Booking.find({ ...active, checkIn: { $lte: today }, checkOut: { $gt: today } })
        .populate("room", "name")
        .sort({ checkOut: 1 })
        .lean(),
      Booking.countDocuments({ bookingStatus: "pending", checkOut: { $gt: today } }),
      Room.find().sort({ pricePerNight: 1 }).lean(),
      EventBooking.find({ status: "confirmed", day: today }).lean(),
      EventBooking.countDocuments({ status: "waiting", day: { $gte: today } }),
    ]);

    const tonight = await availabilityForRooms(rooms, today, tomorrow);

    return res.json({
      success: true,
      date: todayText,
      arrivals: arrivals.map(bookingForAdmin),
      departures: departures.map(bookingForAdmin),
      staying: staying.map(bookingForAdmin),
      waitingForConfirmation: waiting,
      eventsWaiting,
      eventsToday: eventsToday.map((event) => ({
        _id: event._id,
        ref: event.ref,
        typeName: event.typeName,
        startTime: event.startTime,
        endTime: event.endTime,
        people: event.people,
        name: event.name,
        phone: event.phone,
        organisation: event.organisation || "",
        paid: Boolean(event.paid),
      })),
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

router.get("/bookings", seeBookings, async (req, res) => {
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

router.patch("/bookings/:id", changeBookings, async (req, res) => {
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

    const said = [];
    if (changes.bookingStatus && changes.bookingStatus !== booking.bookingStatus) said.push(`status ${changes.bookingStatus}`);
    if (changes.paymentStatus && changes.paymentStatus !== booking.paymentStatus) said.push(`payment ${changes.paymentStatus}`);

    Object.assign(booking, changes);
    await booking.save();

    if (said.length) {
      await audit(req.admin, "bookings", `Booking ${booking.bookingReference} (${booking.guestName}): ${said.join(", ")}`);
    }

    return res.json({ success: true, booking: bookingForAdmin(booking.toObject()) });
  } catch (error) {
    return serverError(res, "Admin booking update failed", error);
  }
});

/* ---------- Rooms booked per night ---------- */

router.get("/occupancy", seeBookings, async (req, res) => {
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

router.get("/rooms", changeRooms, async (req, res) => {
  try {
    const rooms = await Room.find().sort({ pricePerNight: 1 }).lean();
    return res.json({ success: true, rooms });
  } catch (error) {
    return serverError(res, "Admin rooms list failed", error);
  }
});

router.patch("/rooms/:id", changeRooms, async (req, res) => {
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

    const before = await Room.findById(req.params.id).lean();
    const room = await Room.findByIdAndUpdate(req.params.id, { $set: changes }, {
      returnDocument: "after",
      runValidators: true,
    }).lean();

    if (!room) {
      return res.status(404).json({ success: false, message: "Room type not found." });
    }

    const said = [];
    if (changes.pricePerNight !== undefined && changes.pricePerNight !== before.pricePerNight) {
      said.push(`price RWF ${before.pricePerNight} to RWF ${changes.pricePerNight}`);
    }
    if (changes.totalRooms !== undefined && changes.totalRooms !== before.totalRooms) said.push(`rooms ${before.totalRooms} to ${changes.totalRooms}`);
    if (changes.capacity !== undefined && changes.capacity !== before.capacity) said.push(`guests per room ${changes.capacity}`);
    if (changes.available !== undefined && changes.available !== (before.available !== false)) {
      said.push(changes.available ? "open for online booking" : "closed to online booking");
    }
    if (changes.description !== undefined && changes.description !== (before.description || "")) said.push("description changed");
    if (said.length) await audit(req.admin, "rooms", `${room.name}: ${said.join(", ")}`);

    return res.json({ success: true, room });
  } catch (error) {
    return serverError(res, "Admin room update failed", error);
  }
});

module.exports = router;
