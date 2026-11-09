const mongoose = require("mongoose");

/* Something the owner bought for the store. It waits until the manager
   checks it in; only then does the stock go up. */
const purchaseLineSchema = new mongoose.Schema(
  {
    item: { type: mongoose.Schema.Types.ObjectId, ref: "StockItem", required: true },
    itemName: { type: String, default: "" },
    unit: { type: String, default: "" },
    category: { type: String, default: "Other" },
    quantity: { type: Number, min: 0.01, required: true },
    // price for one, in RWF
    unitCost: { type: Number, min: 0, default: 0 },
    // how many the manager found when checking it in (null until then)
    received: { type: Number, min: 0, default: null },
  },
  { _id: false }
);

const purchaseSchema = new mongoose.Schema(
  {
    ref: { type: String, required: true, unique: true }, // P-0001
    supplier: { type: String, trim: true, maxlength: 80, default: "" },
    // the day it was bought (midnight UTC of the Rwanda date)
    day: { type: Date, required: true },
    note: { type: String, trim: true, maxlength: 300, default: "" },
    lines: { type: [purchaseLineSchema], default: [] },
    total: { type: Number, min: 0, default: 0 },
    // waiting: bought, not yet in the store; received: checked in; cancelled
    status: { type: String, enum: ["waiting", "received", "cancelled"], default: "waiting" },

    createdById: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" },
    createdByName: { type: String, default: "" },
    receivedById: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" },
    receivedByName: { type: String, default: "" },
    receivedAt: { type: Date },
    receiveNote: { type: String, trim: true, maxlength: 300, default: "" },
    cancelledByName: { type: String, default: "" },
    cancelledAt: { type: Date },
  },
  { timestamps: true }
);

purchaseSchema.index({ status: 1, day: -1 });
purchaseSchema.index({ day: -1 });

module.exports = mongoose.model("Purchase", purchaseSchema);
