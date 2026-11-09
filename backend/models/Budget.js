const mongoose = require("mongoose");

/* How much the owner plans to spend on one category of stock in a month. */
const budgetSchema = new mongoose.Schema(
  {
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ }, // 2026-11
    category: { type: String, required: true },
    amount: { type: Number, min: 0, default: 0 }, // RWF
  },
  { timestamps: true }
);

budgetSchema.index({ month: 1, category: 1 }, { unique: true });

module.exports = mongoose.model("Budget", budgetSchema);
