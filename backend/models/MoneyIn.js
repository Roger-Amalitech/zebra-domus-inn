const mongoose = require("mongoose");

/* Money that came in: one line for every payment received (see utils/money.js).
   active  counted
   void    taken back (marked not paid again, or the sale or entry was cancelled) */
const moneyInSchema = new mongoose.Schema(
  {
    ref: { type: String, required: true, unique: true }, // M-0001
    amount: { type: Number, required: true, min: 1 },
    day: { type: Date, required: true },
    method: { type: String, enum: ["cash", "momo", "airtel", "card", "bank"], required: true },
    account: { type: String, enum: ["cash", "momo", "airtel", "bank"], required: true },
    source: { type: String, enum: ["booking", "event", "sale", "debt", "other"], required: true },
    sourceId: { type: mongoose.Schema.Types.ObjectId },
    sourceRef: { type: String, default: "" },
    // what kind of income it is for profit and loss ("" = not new income, e.g. paying for a sale made earlier)
    income: { type: String, enum: ["rooms", "events", "sales", "other", ""], default: "" },
    description: { type: String, default: "" },
    customerName: { type: String, default: "" },
    note: { type: String, default: "" },
    status: { type: String, enum: ["active", "void"], default: "active" },
    voidReason: { type: String, default: "" },
    voidedByName: { type: String, default: "" },
    voidedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" },
    createdByName: { type: String, default: "" },
  },
  { timestamps: true }
);

moneyInSchema.index({ status: 1, day: -1 });
moneyInSchema.index({ source: 1, sourceId: 1 });

module.exports = mongoose.model("MoneyIn", moneyInSchema);
