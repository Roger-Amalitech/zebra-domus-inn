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

    // owner:   everything, and manages managers and staff
    // manager: manages staff and what they may do (see utils/permissions.js)
    // staff:   only what a manager or the owner ticked
    role: {
      type: String,
      enum: ["owner", "manager", "staff"],
      default: "staff",
    },

    // What this person may do, for example "stock.use" (see utils/permissions.js).
    // Not set on accounts made before roles existed: they keep what staff
    // could do then, until someone changes their permissions.
    permissions: {
      type: [String],
      default: undefined,
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
