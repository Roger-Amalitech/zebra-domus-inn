const mongoose = require("mongoose");
const { DEPARTMENTS } = require("../utils/departments");

/* A staff member asks for supplies for their department.
   waiting  -> the manager issues it (stock goes down) or turns it down
   issued   -> the staff member confirms they received it
   received / rejected / cancelled */
const requestLineSchema = new mongoose.Schema(
  {
    item: { type: mongoose.Schema.Types.ObjectId, ref: "StockItem", required: true },
    itemName: { type: String, default: "" },
    unit: { type: String, default: "" },
    quantity: { type: Number, min: 0.01, required: true },
    // how many the manager gave (null until issued)
    issued: { type: Number, min: 0, default: null },
  },
  { _id: false }
);

const supplyRequestSchema = new mongoose.Schema(
  {
    ref: { type: String, required: true, unique: true }, // R-0001
    department: { type: String, enum: DEPARTMENTS, required: true },
    note: { type: String, trim: true, maxlength: 200, default: "" },
    lines: { type: [requestLineSchema], default: [] },
    status: {
      type: String,
      enum: ["waiting", "issued", "received", "rejected", "cancelled"],
      default: "waiting",
    },

    requestedById: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser", required: true },
    requestedByName: { type: String, default: "" },
    issuedById: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" },
    issuedByName: { type: String, default: "" },
    issuedAt: { type: Date },
    issueNote: { type: String, trim: true, maxlength: 200, default: "" },
    rejectReason: { type: String, trim: true, maxlength: 200, default: "" },
    receivedAt: { type: Date },
  },
  { timestamps: true }
);

supplyRequestSchema.index({ status: 1, createdAt: -1 });
supplyRequestSchema.index({ requestedById: 1, createdAt: -1 });

module.exports = mongoose.model("SupplyRequest", supplyRequestSchema);
