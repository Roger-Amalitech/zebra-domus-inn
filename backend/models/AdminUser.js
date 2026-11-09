const mongoose = require("mongoose");
const { DEPARTMENTS } = require("../utils/departments");

/* People who can sign in to the admin dashboard.
   Passwords are never stored, only a scrypt hash of them. */
const adminUserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },

    passwordHash: {
      type: String,
      required: true,
    },

    // owner:   purchases, budgets, approvals, money reports, audit, rooms
    // manager: daily stock, supply requests, bookings, staff accounts
    // staff:   asks for supplies (see utils/permissions.js)
    role: {
      type: String,
      enum: ["owner", "manager", "staff"],
      default: "staff",
    },

    // where a staff member works (Housekeeping, Kitchen...); their
    // supply requests start with it
    department: {
      type: String,
      enum: ["", ...DEPARTMENTS],
      default: "",
    },

    active: {
      type: Boolean,
      default: true,
    },

    // Goes up when the password is reset or the account is turned off,
    // which signs that person out everywhere.
    tokenVersion: {
      type: Number,
      default: 0,
    },

    lastLoginAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AdminUser", adminUserSchema);
