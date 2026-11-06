/* =========================================
   ZEBRA DORMUS INN
   Staff accounts (owner only), mounted at /api/admin/staff

   GET    /            everyone who can sign in
   POST   /            { name, email, password }  add a staff member
   PATCH  /:id         { name?, active?, password? }
   DELETE /:id         remove an account
========================================= */

const express = require("express");
const mongoose = require("mongoose");

const AdminUser = require("../models/AdminUser");
const {
  hashPassword,
  passwordProblem,
  isEmail,
  publicUser,
  ownerEmailFromEnv,
} = require("../utils/adminAuth");

const router = express.Router();

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function bad(res, message, status = 400) {
  return res.status(status).json({ success: false, message });
}

function serverError(res, label, error) {
  console.error(`${label}:`, error.message);
  return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
}

const ENV_OWNER_MESSAGE =
  "This is the owner's account from backend/.env. Change ADMIN_EMAIL or ADMIN_PASSWORD there and restart the server.";

router.get("/", async (req, res) => {
  try {
    const users = await AdminUser.find().sort({ role: 1, name: 1 });
    return res.json({ success: true, staff: users.map(publicUser) });
  } catch (error) {
    return serverError(res, "Staff list failed", error);
  }
});

router.post("/", async (req, res) => {
  try {
    const body = req.body || {};
    const name = text(body.name);
    const email = text(body.email).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";

    if (!name || name.length > 80) return bad(res, "Please enter a name (up to 80 characters).");
    if (!isEmail(email)) return bad(res, "Please enter a valid email address.");

    const weak = passwordProblem(password);
    if (weak) return bad(res, weak);

    if (await AdminUser.exists({ email })) {
      return bad(res, "There is already an account with this email.", 409);
    }

    const user = await AdminUser.create({
      name,
      email,
      passwordHash: await hashPassword(password),
      role: "staff",
      active: true,
    });

    return res.status(201).json({ success: true, user: publicUser(user) });
  } catch (error) {
    if (error.code === 11000) return bad(res, "There is already an account with this email.", 409);
    return serverError(res, "Adding staff failed", error);
  }
});

router.patch("/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Unknown account.");

    const user = await AdminUser.findById(req.params.id);
    if (!user) return bad(res, "Account not found.", 404);

    const body = req.body || {};
    const isSelf = String(user._id) === String(req.admin._id);
    const isEnvOwner = user.email === ownerEmailFromEnv();
    let signOut = false;

    if (body.name !== undefined) {
      const name = text(body.name);
      if (!name || name.length > 80) return bad(res, "Please enter a name (up to 80 characters).");
      user.name = name;
    }

    if (body.active !== undefined) {
      if (typeof body.active !== "boolean") return bad(res, "Active must be yes or no.");
      if (isEnvOwner) return bad(res, ENV_OWNER_MESSAGE);
      if (isSelf && body.active === false) return bad(res, "You can't turn off your own account.");
      if (user.active && body.active === false) signOut = true;
      user.active = body.active;
    }

    if (body.password !== undefined) {
      if (isEnvOwner) return bad(res, ENV_OWNER_MESSAGE);
      const weak = passwordProblem(body.password);
      if (weak) return bad(res, weak);
      user.passwordHash = await hashPassword(body.password);
      signOut = true;
    }

    if (signOut) user.tokenVersion = (user.tokenVersion || 0) + 1;

    await user.save();
    return res.json({ success: true, user: publicUser(user) });
  } catch (error) {
    return serverError(res, "Staff update failed", error);
  }
});

router.delete("/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Unknown account.");

    const user = await AdminUser.findById(req.params.id);
    if (!user) return bad(res, "Account not found.", 404);

    if (String(user._id) === String(req.admin._id)) return bad(res, "You can't remove your own account.");
    if (user.email === ownerEmailFromEnv()) return bad(res, ENV_OWNER_MESSAGE);

    await AdminUser.deleteOne({ _id: user._id });
    return res.json({ success: true });
  } catch (error) {
    return serverError(res, "Removing staff failed", error);
  }
});

module.exports = router;
