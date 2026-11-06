/* =========================================
   ZEBRA DORMUS INN
   GET /api/availability?checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD
   Tells the booking page how many rooms of each type are free.
   Shows counts only, never who booked.
========================================= */

const express = require("express");

const Room = require("../models/Room");
const {
  parseDay,
  nightsBetween,
  innToday,
  availabilityForRooms,
} = require("../utils/availability");

const router = express.Router();

const MAX_NIGHTS = 60;

router.get("/", async (req, res) => {
  try {
    const checkIn = parseDay(req.query.checkIn);
    const checkOut = parseDay(req.query.checkOut);

    if (!checkIn || !checkOut) {
      return res.status(400).json({
        success: false,
        message: "Please provide check-in and check-out dates (YYYY-MM-DD).",
      });
    }

    if (checkOut <= checkIn) {
      return res.status(400).json({
        success: false,
        message: "Check-out must be after check-in.",
      });
    }

    if (req.query.checkIn < innToday()) {
      return res.status(400).json({
        success: false,
        message: "Check-in cannot be in the past.",
      });
    }

    const nights = nightsBetween(checkIn, checkOut);

    if (nights > MAX_NIGHTS) {
      return res.status(400).json({
        success: false,
        message: `Stays can be up to ${MAX_NIGHTS} nights. Please contact us for longer stays.`,
      });
    }

    const rooms = await Room.find({ available: true }).sort({ pricePerNight: 1 }).lean();
    const counts = await availabilityForRooms(rooms, checkIn, checkOut);

    return res.status(200).json({
      success: true,
      checkIn: req.query.checkIn,
      checkOut: req.query.checkOut,
      nights,
      rooms: rooms.map((room) => {
        const count = counts.get(String(room._id));

        return {
          _id: room._id,
          name: room.name,
          capacity: room.capacity,
          pricePerNight: room.pricePerNight,
          totalRooms: count.totalRooms,
          available: count.available,
        };
      }),
    });
  } catch (error) {
    console.error("Availability check failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to check availability right now.",
    });
  }
});

module.exports = router;
