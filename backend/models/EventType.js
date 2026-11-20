const mongoose = require("mongoose");

/* The kinds of events guests can book (see utils/events.js), with the
   price the owner set and whether the website takes requests for them. */
const eventTypeSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    price: { type: Number, default: null, min: 0 }, // whole RWF for the event; null = not set yet
    open: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("EventType", eventTypeSchema);
