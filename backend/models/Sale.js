const mongoose = require("mongoose");

/* Something sold from the store (drinks at the bar, food...): the stock goes down
   (a stock change "out" to "Sold") and the money comes in, or, on credit, a debt is opened. */
const saleLineSchema = new mongoose.Schema(
  {
    item: { type: mongoose.Schema.Types.ObjectId, ref: "StockItem" }, // none for a meal or a service
    itemName: { type: String, default: "" },
    unit: { type: String, default: "" },
    quantity: { type: Number, min: 0.01, required: true },
    price: { type: Number, min: 0, required: true }, // selling price for one (RWF)
    unitCost: { type: Number, min: 0, default: 0 }, // what one cost to buy, at the time
  },
  { _id: false }
);

const saleSchema = new mongoose.Schema(
  {
    ref: { type: String, required: true, unique: true }, // S-0001
    day: { type: Date, required: true },
    lines: { type: [saleLineSchema], default: [] },
    total: { type: Number, min: 0, required: true },
    cost: { type: Number, min: 0, default: 0 },
    // how it was paid; "credit" = not paid now, a debt was opened
    paidWith: { type: String, enum: ["cash", "momo", "airtel", "card", "bank", "credit"], required: true },
    customerName: { type: String, default: "" },
    phone: { type: String, default: "" },
    note: { type: String, default: "" },
    debt: { type: mongoose.Schema.Types.ObjectId, ref: "Debt" },
    status: { type: String, enum: ["done", "cancelled"], default: "done" },
    soldBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" },
    soldByName: { type: String, default: "" },
    cancelledByName: { type: String, default: "" },
    cancelledAt: { type: Date },
    reason: { type: String, default: "" },
  },
  { timestamps: true }
);

saleSchema.index({ status: 1, day: -1 });

module.exports = mongoose.model("Sale", saleSchema);
