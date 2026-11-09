const mongoose = require("mongoose");

/* Who did what, and when. Written by the server on every change;
   nobody can edit or delete it from the dashboard. */
const AUDIT_AREAS = ["sign-in", "bookings", "rooms", "users", "stock", "purchases", "requests", "budget"];

const auditLogSchema = new mongoose.Schema(
  {
    area: { type: String, enum: AUDIT_AREAS, required: true },
    action: { type: String, maxlength: 300, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" },
    userName: { type: String, default: "" },
    role: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ area: 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
module.exports.AUDIT_AREAS = AUDIT_AREAS;
