const mongoose = require("mongoose");

/* Every change to the stock:
   in    - received or bought
   out   - used
   count - someone counted the shelf and corrected the number */
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
