const mongoose = require("mongoose");

/* A house party or swimming competition at the inn.

   waiting    asked for on the website; the owner or manager confirms it
   confirmed  the day is taken: no other event can be confirmed that day
   declined   turned down (with a reason)
   cancelled  was confirmed, then cancelled: the day is free again */
const eventBookingSchema = new mongoose.Schema(
  {
    ref: { type: String, required: true, unique: true }, // E-0001
    type: { type: String, required: true },
    typeName: { type: String, required: true },
    day: { type: Date, required: true },
    startTime: { type: String, required: true }, // "14:00"
    endTime: { type: String, required: true },
    people: { type: Number, required: true, min: 1 },

    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    organisation: { type: String, default: "", trim: true },
    note: { type: String, default: "" },

    price: { type: Number, default: null }, // the event's price when it was asked for
    paid: { type: Boolean, default: false },

    status: {
      type: String,
      enum: ["waiting", "confirmed", "declined", "cancelled"],
      default: "waiting",
    },
    source: { type: String, enum: ["website", "phone", "walk-in"], default: "website" },

    createdByName: { type: String, default: "" }, // staff who added it (phone or walk-in)
    handledByName: { type: String, default: "" }, // who confirmed, turned down or cancelled
    handledAt: { type: Date },
    reason: { type: String, default: "" }, // why it was turned down or cancelled
  },
  { timestamps: true }
);

eventBookingSchema.index({ day: 1, status: 1 });

// One event per day: the database itself refuses a second confirmed event
// on the same day, even if two people press Confirm at the same moment.
eventBookingSchema.index(
  { day: 1 },
  { unique: true, partialFilterExpression: { status: "confirmed" }, name: "one_confirmed_event_per_day" }
);

module.exports = mongoose.model("EventBooking", eventBookingSchema);
