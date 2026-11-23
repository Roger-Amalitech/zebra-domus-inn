const mongoose = require("mongoose");

/* Money that went out for running the inn (not stock: stock is a purchase). */
const EXPENSE_CATEGORIES = [
  "Salaries and wages",
  "Electricity and water",
  "Internet and phone",
  "Repairs and maintenance",
  "Transport and fuel",
  "Taxes and fees",
  "Marketing",
  "Bank and MoMo charges",
  "Rent",
  "Other",
];

const expenseSchema = new mongoose.Schema(
  {
    ref: { type: String, required: true, unique: true }, // X-0001
    day: { type: Date, required: true },
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
    amount: { type: Number, required: true, min: 1 },
    method: { type: String, enum: ["cash", "momo", "airtel", "card", "bank"], required: true },
    account: { type: String, enum: ["cash", "momo", "airtel", "bank"], required: true },
    paidTo: { type: String, default: "" },
    note: { type: String, default: "" },
    status: { type: String, enum: ["done", "cancelled"], default: "done" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" },
    createdByName: { type: String, default: "" },
    cancelledByName: { type: String, default: "" },
    cancelledAt: { type: Date },
    reason: { type: String, default: "" },
  },
  { timestamps: true }
);

expenseSchema.index({ status: 1, day: -1 });

module.exports = mongoose.model("Expense", expenseSchema);
module.exports.EXPENSE_CATEGORIES = EXPENSE_CATEGORIES;
