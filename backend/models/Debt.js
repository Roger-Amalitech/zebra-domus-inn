const mongoose = require("mongoose");

/* A customer who owes the inn money: a guest who left without paying in full,
   a company that pays at the end of the month, an event with a balance, a bar tab.

   open       money is still owed
   paid       paid in full (by one or more payments)
   forgiven   the owner wrote off what was left (with a reason)
   cancelled  recorded by mistake, before any payment (owner, with a reason) */
const PAYMENT_METHODS = ["cash", "momo", "airtel", "card", "bank"];
const DEBT_KINDS = ["room", "event", "restaurant", "other"];
const DEBT_STATUSES = ["open", "paid", "forgiven", "cancelled"];

const paymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 1 },
    day: { type: Date, required: true },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    note: { type: String, default: "" },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" },
    receivedByName: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const debtSchema = new mongoose.Schema(
  {
    ref: { type: String, required: true, unique: true }, // D-0001
    customerName: { type: String, required: true, trim: true },
    phone: { type: String, default: "", trim: true },
    phoneKey: { type: String, default: "" }, // last 9 digits, to group one customer's debts

    kind: { type: String, enum: DEBT_KINDS, default: "other" },
    description: { type: String, default: "" }, // what for, in words
    booking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking" },
    event: { type: mongoose.Schema.Types.ObjectId, ref: "EventBooking" },
    linkedRef: { type: String, default: "" }, // the booking, event or sale reference
    sale: { type: mongoose.Schema.Types.ObjectId, ref: "Sale" }, // a sale on credit

    amount: { type: Number, required: true, min: 1 }, // owed at the start (RWF)
    paid: { type: Number, default: 0 },
    forgiven: { type: Number, default: 0 },
    day: { type: Date, required: true }, // when the debt started
    dueDay: { type: Date, default: null }, // when they promised to pay
    note: { type: String, default: "" },

    status: { type: String, enum: DEBT_STATUSES, default: "open" },
    payments: { type: [paymentSchema], default: [] },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" },
    createdByName: { type: String, default: "" },
    closedByName: { type: String, default: "" },
    closedAt: { type: Date },
    reason: { type: String, default: "" }, // why it was forgiven or cancelled
  },
  { timestamps: true }
);

debtSchema.index({ status: 1, dueDay: 1 });
debtSchema.index({ phoneKey: 1 });
debtSchema.index({ booking: 1 });
debtSchema.index({ event: 1 });

module.exports = mongoose.model("Debt", debtSchema);
module.exports.PAYMENT_METHODS = PAYMENT_METHODS;
module.exports.DEBT_KINDS = DEBT_KINDS;
module.exports.DEBT_STATUSES = DEBT_STATUSES;
