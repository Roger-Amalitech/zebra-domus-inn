
const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");

const router = express.Router();

const Room = require("../models/Room");
const Booking = require("../models/Booking");
const {
  parseDay,
  nightsBetween,
  innToday,
  availabilityForRooms,
} = require("../utils/availability");

const MAX_NIGHTS = 60;

const allowedPaymentMethods = [
  "MTN Mobile Money",
  "Airtel Money",
  "Visa/Mastercard",
  "Pay at the Motel",
];

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

/* Other room types that are free for the same stay and fit the group,
   so the booking page can offer them straight away. */
async function freeAlternatives(arrival, departure, guestCount) {
  const rooms = await Room.find({ available: true }).sort({ pricePerNight: 1 }).lean();
  const counts = await availabilityForRooms(rooms, arrival, departure);

  return rooms
    .map((room) => ({
      _id: room._id,
      name: room.name,
      capacity: room.capacity,
      pricePerNight: room.pricePerNight,
      available: counts.get(String(room._id)).available,
    }))
    .filter((room) => room.available > 0 && room.capacity >= guestCount);
}

function roomTakenResponse(res, room, alternatives) {
  return res.status(409).json({
    success: false,
    code: "ROOM_TAKEN",
    roomId: room._id,
    message: alternatives.length
      ? `The ${room.name} is no longer free for those dates. Still free: ${alternatives.map((r) => r.name).join(", ")}.`
      : "All rooms are booked for those dates. Please choose other dates.",
    alternatives,
  });
}

// Create a new booking
router.post("/", async (req, res) => {
  try {
    const body = req.body || {};
    const guestName = text(body.guestName);
    const guestEmail = text(body.guestEmail).toLowerCase();
    const guestPhone = text(body.guestPhone);
    const roomId = text(body.roomId);
    const checkIn = text(body.checkIn);
    const checkOut = text(body.checkOut);
    const paymentMethod = text(body.paymentMethod);
    const guestCount = Number(body.guests);

    // Validate required fields
    if (
      !guestName ||
      !guestEmail ||
      !guestPhone ||
      !roomId ||
      !checkIn ||
      !checkOut ||
      !body.guests ||
      !paymentMethod
    ) {
      return res.status(400).json({
        success: false,
        message: "Please complete all booking fields.",
      });
    }

    if (guestName.length > 100 || guestEmail.length > 254 || guestPhone.length > 30) {
      return res.status(400).json({
        success: false,
        message: "Some of the details are too long. Please check them.",
      });
    }

    // Validate room ID
    if (!mongoose.Types.ObjectId.isValid(roomId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid room selection.",
      });
    }

    // Validate email, phone and guest count
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(guestEmail)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address.",
      });
    }

    if ((guestPhone.match(/\d/g) || []).length < 9) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid phone number.",
      });
    }

    if (!Number.isInteger(guestCount) || guestCount < 1) {
      return res.status(400).json({
        success: false,
        message: "Number of guests must be at least 1.",
      });
    }

    if (!allowedPaymentMethods.includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: "Please select a valid payment method.",
      });
    }

    // Validate dates (YYYY-MM-DD, compared with today's date in Rwanda)
    const arrival = parseDay(checkIn);
    const departure = parseDay(checkOut);

    if (!arrival || !departure) {
      return res.status(400).json({
        success: false,
        message: "Please provide valid check-in and check-out dates.",
      });
    }

    if (checkIn < innToday()) {
      return res.status(400).json({
        success: false,
        message: "Check-in cannot be in the past.",
      });
    }

    if (departure <= arrival) {
      return res.status(400).json({
        success: false,
        message: "Check-out must be after check-in.",
      });
    }

    const nights = nightsBetween(arrival, departure);

    if (nights > MAX_NIGHTS) {
      return res.status(400).json({
        success: false,
        message: `Stays can be up to ${MAX_NIGHTS} nights. Please contact us for longer stays.`,
      });
    }

    // Find the selected room
    const room = await Room.findOne({
      _id: roomId,
      available: true,
    });

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "The selected room type was not found.",
      });
    }

    if (guestCount > room.capacity) {
      return res.status(400).json({
        success: false,
        message: `This room allows up to ${room.capacity} guests.`,
      });
    }

    // Is a room of this type free on every night of the stay?
    // Cancelled bookings do not block availability.
    const before = await availabilityForRooms([room], arrival, departure);

    if (before.get(String(room._id)).available <= 0) {
      return roomTakenResponse(res, room, await freeAlternatives(arrival, departure, guestCount));
    }

    // Calculate price on the server, not from the browser.
    const totalPrice = nights * room.pricePerNight;

    const bookingReference =
      "ZDI-" + crypto.randomBytes(4).toString("hex").toUpperCase();

    const booking = await Booking.create({
      bookingReference,
      guestName,
      guestEmail,
      guestPhone,
      room: room._id,
      checkIn: arrival,
      checkOut: departure,
      guests: guestCount,
      totalPrice,
      paymentMethod,
      paymentStatus: "pending",
      bookingStatus: "pending",
    });

    // Two guests can press "Confirm" for the last room at the same moment.
    // Count again, this time only the bookings made before this one: if they
    // already fill the room type on any night, this booking came second, so
    // it gives way and the guest is offered the rooms that are still free.
    const earlier = await availabilityForRooms([room], arrival, departure, {
      beforeId: booking._id,
    });

    if (earlier.get(String(room._id)).available <= 0) {
      await Booking.deleteOne({ _id: booking._id });
      return roomTakenResponse(res, room, await freeAlternatives(arrival, departure, guestCount));
    }

    return res.status(201).json({
      success: true,
      message: "Booking request received successfully.",
      booking: {
        bookingReference: booking.bookingReference,
        guestName: booking.guestName,
        room: room.name,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        nights,
        guests: booking.guests,
        pricePerNight: room.pricePerNight,
        totalPrice: booking.totalPrice,
        currency: "RWF",
        paymentMethod: booking.paymentMethod,
        paymentStatus: booking.paymentStatus,
        bookingStatus: booking.bookingStatus,
      },
    });
  } catch (error) {
    console.error("Booking creation failed:", error.message);

    if (error.code === 11000) {
      return res.status(500).json({
        success: false,
        message: "Please try submitting your booking again.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Unable to create your booking. Please try again.",
    });
  }
});

module.exports = router;
