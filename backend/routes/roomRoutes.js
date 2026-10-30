
const express = require("express");
const router = express.Router();
const Room = require("../models/Room");

router.get("/", async (req, res) => {
  try {
    const rooms = await Room.find({ available: true }).sort({
      pricePerNight: 1,
    });

    res.status(200).json({
      success: true,
      count: rooms.length,
      rooms,
    });
  } catch (error) {
    console.error("Error fetching rooms:", error.message);

    res.status(500).json({
      success: false,
      message: "Unable to retrieve rooms.",
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid room ID.",
      });
    }

    const room = await Room.findOne({
      _id: req.params.id,
      available: true,
    });

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room type not found.",
      });
    }

    res.status(200).json({
      success: true,
      room,
    });
  } catch (error) {
    console.error("Error fetching room:", error.message);

    res.status(500).json({
      success: false,
      message: "Unable to retrieve the room.",
    });
  }
});

module.exports = router;
