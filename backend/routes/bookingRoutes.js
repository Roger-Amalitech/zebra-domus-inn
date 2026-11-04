
const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");

const router = express.Router();

const Room = require("../models/Room");
const Booking = require("../models/Booking");

// Create a new booking
router.post("/", async (req, res) => {
  try {
    const {
      guestName,
      guestEmail,
      guestPhone,
      roomId,
      checkIn,
      checkOut,
      guests,
      paymentMethod,
    } = req.body;

    // Validate required fields
    if (
      !guestName ||
      !guestEmail ||
      !guestPhone ||
      !roomId ||
      !checkIn ||
      !checkOut ||
      !guests ||
      !paymentMethod
    ) {
      return res.status(400).json({
        success: false,
        message: "Please complete all booking fields.",
      });
    }

    // Validate room ID
    if (!mongoose.Types.ObjectId.isValid(roomId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid room selection.",
      });
    }

    // Validate email and guest count
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const guestCount = Number(guests);

    if (!emailPattern.test(guestEmail)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address.",
      });
    }

    if (!Number.isInteger(guestCount) || guestCount < 1) {
      return res.status(400).json({
        success: false,
        message: "Number of guests must be at least 1.",
      });
    }

    const allowedPaymentMethods = [
      "MTN Mobile Money",
      "Airtel Money",
      "Visa/Mastercard",
      "Pay at the Motel",
    ];

    if (!allowedPaymentMethods.includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: "Please select a valid payment method.",
      });
    }

    // Validate dates
    const arrival = new Date(checkIn);
    const departure = new Date(checkOut);

    if (
      Number.isNaN(arrival.getTime()) ||
      Number.isNaN(departure.getTime())
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide valid check-in and check-out dates.",
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (arrival < today) {
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

    // Count bookings that overlap the requested dates.
    // Cancelled bookings do not block availability.
    const overlappingBookings = await Booking.countDocuments({
      room: room._id,
      bookingStatus: { $ne: "cancelled" },
      checkIn: { $lt: departure },
      checkOut: { $gt: arrival },
    });

    if (overlappingBookings >= room.totalRooms) {
      return res.status(409).json({
        success: false,
        message: "This room is not available for those dates. Please choose other dates.",
      });
    }

    // Calculate price on the server, not from the browser.
    const millisecondsPerDay = 1000 * 60 * 60 * 24;
    const nights = Math.round(
      (departure.getTime() - arrival.getTime()) /
        millisecondsPerDay
    );

    const totalPrice = nights * room.pricePerNight;

    const bookingReference =
      "ZDI-" + crypto.randomBytes(4).toString("hex").toUpperCase();

    const booking = await Booking.create({
      bookingReference,
      guestName: guestName.trim(),
      guestEmail: guestEmail.trim().toLowerCase(),
      guestPhone: guestPhone.trim(),
      room: room._id,
      checkIn: arrival,
      checkOut: departure,
      guests: guestCount,
      totalPrice,
      paymentMethod,
      paymentStatus: "pending",
      bookingStatus: "pending",
    });

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
