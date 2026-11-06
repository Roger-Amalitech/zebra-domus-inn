
const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI;

    if (!mongoURI) {
      throw new Error("MONGODB_URI is missing. Add it to backend/.env on your computer, or to Environment on Render.");
    }

    await mongoose.connect(mongoURI);

    console.log("MongoDB Atlas connected successfully");
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  }
};

module.exports = connectDB;
