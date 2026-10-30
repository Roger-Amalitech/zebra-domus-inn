
require("dotenv").config();

const mongoose = require("mongoose");
const Room = require("./models/Room");

const rooms = [
  {
    name: "Standard Room",
    pricePerNight: 25000,
    description: "A cozy, comfortable room for a restful stay.",
    image:
      "images/room-standard.jpg",
    capacity: 2,
    totalRooms: 1,
    available: true,
  },
  {
    name: "Deluxe Room",
    pricePerNight: 40000,
    description: "Extra space and comfort for a special getaway.",
    image:
      "images/room-deluxe.jpg",
    capacity: 2,
    totalRooms: 1,
    available: true,
  },
  {
    name: "Family Room",
    pricePerNight: 55000,
    description: "A spacious, comfortable room for families.",
    image:
      "images/room-family.jpg",
    capacity: 4,
    totalRooms: 1,
    available: true,
  },
];

async function seedRooms() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB Atlas.");

    for (const roomData of rooms) {
      await Room.findOneAndUpdate(
        { name: roomData.name },
        { $set: roomData },
        { upsert: true, new: true, runValidators: true }
      );

      console.log(`Updated: ${roomData.name}`);
    }

   
    console.log("Room records updated successfully.");
  } catch (error) {
    console.error("Room seeding failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

seedRooms();
