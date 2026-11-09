const mongoose = require("mongoose");

/* A manager counted an item and found a different number.
   The stock only changes when the owner approves it. */
const stockCountSchema = new mongoose.Schema(
  {
    item: { type: mongoose.Schema.Types.ObjectId, ref: "StockItem", required: true },
    itemName: { type: String, default: "" },
    unit: { type: String, default: "" },
    recorded: { type: Number, required: true }, // what the record said at the count
    counted: { type: Number, min: 0, required: true },
    change: { type: Number, required: true }, // counted - recorded
    note: { type: String, trim: true, maxlength: 200, default: "" },
    day: { type: Date, required: true },
    status: { type: String, enum: ["waiting", "approved", "rejected"], default: "waiting" },

    countedById: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" },
    countedByName: { type: String, default: "" },
    decidedByName: { type: String, default: "" },
    decidedAt: { type: Date },
    reason: { type: String, trim: true, maxlength: 200, default: "" },
  },
  { timestamps: true }
);

stockCountSchema.index({ status: 1, createdAt: -1 });
stockCountSchema.index({ item: 1, status: 1 });

module.exports = mongoose.model("StockCount", stockCountSchema);
