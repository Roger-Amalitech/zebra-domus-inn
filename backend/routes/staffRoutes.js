/* =========================================
   ZEBRA DORMUS INN
   User accounts, mounted at /api/admin/staff (owner and managers)

   GET    /            everyone who can sign in
   POST   /            { name, email, password, role?, department? }
   PATCH  /:id         { name?, active?, password?, role?, department? }
   DELETE /:id         remove an account

   The owner adds and changes managers and staff.
   A manager adds and changes staff.
   What each role may do is fixed (see utils/permissions.js).
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
  clearFailuresFor,
} = require("../utils/adminAuth");
const { canManage } = require("../utils/permissions");
const { DEPARTMENTS } = require("../utils/departments");
const { audit } = require("../utils/audit");

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

const ROLE_NAMES = { owner: "Owner", manager: "Manager", staff: "Staff" };

// the roles the signed-in person can give
function rolesFor(actor) {
  return actor.role === "owner" ? ["manager", "staff"] : ["staff"];
}

// why the signed-in person can't change this account ("" if they can)
function whyNot(actor, user) {
  if (String(user._id) === String(actor._id)) return "This is your own account. Change your password in My account.";
  if (user.email === ownerEmailFromEnv()) return ENV_OWNER_MESSAGE;
  if (user.role === "owner") return "Only the owner can change this account.";
  if (!canManage(actor, user)) return "Only the owner can change a manager's account.";
  return "";
}

function userForList(actor, user) {
  return { ...publicUser(user), canEdit: !whyNot(actor, user) };
}

function readDepartment(value) {
  const department = text(value);
  return department === "" || DEPARTMENTS.includes(department) ? department : null;
}

router.get("/", async (req, res) => {
  try {
    const users = await AdminUser.find();
    const order = { owner: 0, manager: 1, staff: 2 };

    users.sort((a, b) => (order[a.role] - order[b.role]) || a.name.localeCompare(b.name));

    return res.json({
      success: true,
      staff: users.map((user) => userForList(req.admin, user)),
      roles: rolesFor(req.admin),
      departments: DEPARTMENTS,
    });
  } catch (error) {
    return serverError(res, "User list failed", error);
  }
});

router.post("/", async (req, res) => {
  try {
    const body = req.body || {};
    const name = text(body.name);
    const email = text(body.email).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const role = body.role === undefined ? "staff" : body.role;
    const department = readDepartment(body.department);

    if (!name || name.length > 80) return bad(res, "Please enter a name (up to 80 characters).");
    if (!isEmail(email)) return bad(res, "Please enter a valid email address.");

    const weak = passwordProblem(password);
    if (weak) return bad(res, weak);

    if (!["manager", "staff"].includes(role)) return bad(res, "Choose Manager or Staff.");
    if (!rolesFor(req.admin).includes(role)) return bad(res, "Only the owner can add a manager.", 403);
    if (department === null) return bad(res, "Choose a department from the list.");

    if (await AdminUser.exists({ email })) {
      return bad(res, "There is already an account with this email.", 409);
    }

    const user = await AdminUser.create({
      name,
      email,
      passwordHash: await hashPassword(password),
      role,
      department,
      active: true,
    });

    await audit(req.admin, "users", `Added ${ROLE_NAMES[role].toLowerCase()} ${name} (${email})` + (department ? `, ${department}` : ""));
    return res.status(201).json({ success: true, user: userForList(req.admin, user) });
  } catch (error) {
    if (error.code === 11000) return bad(res, "There is already an account with this email.", 409);
    return serverError(res, "Adding a user failed", error);
  }
});

router.patch("/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Unknown account.");

    const user = await AdminUser.findById(req.params.id);
    if (!user) return bad(res, "Account not found.", 404);

    const reason = whyNot(req.admin, user);
    if (reason) return bad(res, reason, 403);

    const body = req.body || {};
    const said = [];
    let signOut = false;

    if (body.name !== undefined) {
      const name = text(body.name);
      if (!name || name.length > 80) return bad(res, "Please enter a name (up to 80 characters).");
      if (name !== user.name) said.push(`renamed from ${user.name}`);
      user.name = name;
    }

    if (body.role !== undefined && body.role !== user.role) {
      if (!["manager", "staff"].includes(body.role)) return bad(res, "Choose Manager or Staff.");
      if (!rolesFor(req.admin).includes(body.role)) return bad(res, "Only the owner can change someone's role.", 403);
      said.push(`role ${ROLE_NAMES[user.role]} to ${ROLE_NAMES[body.role]}`);
      user.role = body.role;
    }

    if (body.department !== undefined) {
      const department = readDepartment(body.department);
      if (department === null) return bad(res, "Choose a department from the list.");
      if (department !== user.department) said.push(`department ${department || "none"}`);
      user.department = department;
    }

    if (body.active !== undefined) {
      if (typeof body.active !== "boolean") return bad(res, "Active must be yes or no.");
      if (user.active && body.active === false) signOut = true;
      if (user.active !== body.active) said.push(body.active ? "turned on" : "turned off");
      user.active = body.active;
    }

    if (body.password !== undefined) {
      const weak = passwordProblem(body.password);
      if (weak) return bad(res, weak);
      user.passwordHash = await hashPassword(body.password);
      clearFailuresFor(user.email); // locked out by wrong passwords? the new one works at once
      said.push("password reset");
      signOut = true;
    }

    if (signOut) user.tokenVersion = (user.tokenVersion || 0) + 1;

    await user.save();
    if (said.length) await audit(req.admin, "users", `Changed ${user.name}: ${said.join(", ")}`);

    return res.json({ success: true, user: userForList(req.admin, user) });
  } catch (error) {
    return serverError(res, "User update failed", error);
  }
});

router.delete("/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Unknown account.");

    const user = await AdminUser.findById(req.params.id);
    if (!user) return bad(res, "Account not found.", 404);

    const reason = whyNot(req.admin, user);
    if (reason) return bad(res, reason, 403);

    await AdminUser.deleteOne({ _id: user._id });
    await audit(req.admin, "users", `Removed ${ROLE_NAMES[user.role].toLowerCase()} ${user.name} (${user.email})`);

    return res.json({ success: true });
  } catch (error) {
    return serverError(res, "Removing a user failed", error);
  }
});

module.exports = router;
