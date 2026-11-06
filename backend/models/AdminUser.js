const mongoose = require("mongoose");

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

    // owner: everything, including rooms, prices and staff accounts
    // staff: today, bookings and availability
    role: {
      type: String,
      enum: ["owner", "staff"],
      default: "staff",
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
