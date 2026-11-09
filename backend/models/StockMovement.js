const mongoose = require("mongoose");

/* Every change to the stock:
   in    - checked in from a purchase (or the starting stock)
   out   - issued to a department or used
   count - the shelf was counted and the number corrected
           (a manager's difference only counts once the owner approves it) */
const stockMovementSchema = new mongoose.Schema(
  {
    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StockItem",
      required: true,
    },
    itemName: {
      type: String,
      default: "",
    },
    type: {
      type: String,
      enum: ["in", "out", "count"],
      required: true,
    },
    // the number typed in: how many came in / were used / were counted
    quantity: {
      type: Number,
      min: 0,
      required: true,
    },
    // how much the stock went up (+) or down (-)
    change: {
      type: Number,
      required: true,
    },
    balanceAfter: {
      type: Number,
      required: true,
    },
    // price paid for one, for things received
    unitCost: {
      type: Number,
      min: 0,
    },
    note: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
    },
    // the day it happened (midnight UTC of the Rwanda date)
    day: {
      type: Date,
      required: true,
    },
    // who it went to (for "out")
    department: {
      type: String,
      default: "",
    },
    // the purchase (P-0001) or request (R-0001) it belongs to
    ref: {
      type: String,
      default: "",
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
    },
    userName: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

stockMovementSchema.index({ item: 1, day: -1 });
stockMovementSchema.index({ createdAt: -1 });

module.exports = mongoose.model("StockMovement", stockMovementSchema);
