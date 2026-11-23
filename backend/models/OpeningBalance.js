const mongoose = require("mongoose");

/* What was in each account on the day the inn started using the money records.
   The newest one counts; older ones are kept for the record. */
const openingBalanceSchema = new mongoose.Schema(
  {
    day: { type: Date, required: true },
    cash: { type: Number, min: 0, default: 0 },
    momo: { type: Number, min: 0, default: 0 },
    airtel: { type: Number, min: 0, default: 0 },
    bank: { type: Number, min: 0, default: 0 },
    setByName: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("OpeningBalance", openingBalanceSchema);
