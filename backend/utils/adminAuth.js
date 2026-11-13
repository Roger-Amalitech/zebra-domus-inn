/* =========================================
   ZEBRA DORMUS INN
   Staff sign-in with email and password.

   The owner's sign-in comes from backend/.env:
     ADMIN_EMAIL=owner@example.com
     ADMIN_PASSWORD=at-least-8-characters
     ADMIN_NAME=Roger            (optional: the name shown in the dashboard)
   It is created when the server starts, and its password is updated
   from .env on every start (so a forgotten password is fixed there).
   The owner adds managers and staff in the dashboard (Users tab);
   managers add staff. What each role may do: utils/permissions.js.

   Signing in gives a token that lasts 12 hours. Turning an account
   off, removing it or resetting its password signs that person out.
========================================= */

const crypto = require("crypto");
const { promisify } = require("util");
const mongoose = require("mongoose");

const AdminUser = require("../models/AdminUser");
const { permissionsOf } = require("./permissions");
const { audit } = require("./audit");

const scrypt = promisify(crypto.scrypt);

const TOKEN_HOURS = 12;
const MAX_FAILED_TRIES = 5;
const LOCK_MINUTES = 15;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* The secret that signs tokens. A new one is made each time the server
   starts, so a restart (Render waking up, or a deploy) signs everyone out.
   ADMIN_TOKEN_SECRET in .env can be set to keep people signed in instead. */
const tokenSecret =
  process.env.ADMIN_TOKEN_SECRET || crypto.randomBytes(32).toString("hex");

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function ownerEmailFromEnv() {
  return text(process.env.ADMIN_EMAIL).toLowerCase();
}

function isEmail(value) {
  return typeof value === "string" && value.length <= 254 && EMAIL_PATTERN.test(value);
}

/* Returns a message if the password is too weak, otherwise "". */
function passwordProblem(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    return `The password must be at least ${MIN_PASSWORD} characters.`;
  }
  if (password.length > MAX_PASSWORD) {
    return `The password can be up to ${MAX_PASSWORD} characters.`;
  }
  return "";
}

/* ---------- Passwords ---------- */

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(password), salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

async function passwordMatches(password, stored) {
  const parts = String(stored || "").split("$");

  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }

  const salt = Buffer.from(parts[1], "base64");
  const expected = Buffer.from(parts[2], "base64");
  const actual = await scrypt(String(password), salt, expected.length);

  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/* A wrong email takes as long to answer as a wrong password, so the
   sign-in page doesn't reveal which emails have accounts. */
let spareHash = null;

async function takeSameTime(password) {
  if (!spareHash) spareHash = await hashPassword(crypto.randomBytes(16).toString("hex"));
  await passwordMatches(password, spareHash);
}

/* ---------- Tokens ---------- */

function sign(payload) {
  return crypto.createHmac("sha256", tokenSecret).update(payload).digest("base64url");
}

function makeToken(user) {
  const payload = Buffer.from(
    JSON.stringify({
      uid: String(user._id),
      v: user.tokenVersion || 0,
      exp: Date.now() + TOKEN_HOURS * 60 * 60 * 1000,
    })
  ).toString("base64url");

  return `${payload}.${sign(payload)}`;
}

/* Returns { data } for a good token, or { why } saying why it can't be used. */
function readToken(token) {
  if (typeof token !== "string" || !token.includes(".")) {
    return { why: "Please sign in again." };
  }

  const [payload, signature] = token.split(".");

  if (!payload || !signature) {
    return { why: "Please sign in again." };
  }

  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);

  // signed with an earlier secret: the server has restarted since
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    return { why: "You were signed out because the server restarted. Please sign in again." };
  }

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!mongoose.isValidObjectId(data.uid)) return { why: "Please sign in again." };
    if (!(Number(data.exp) > Date.now())) {
      return { why: `Your sign-in ended after ${TOKEN_HOURS} hours. Please sign in again.` };
    }
    return { data };
  } catch (error) {
    return { why: "Please sign in again." };
  }
}

/* ---------- Too many wrong tries ---------- */

/* After 5 wrong passwords for the same email from the same place, that
   email waits 15 minutes there. Colleagues on the same Wi-Fi can still
   sign in. A place that gets many emails wrong (someone guessing) waits
   too. A manager or the owner resetting the password ends the wait. */
const MAX_FAILED_PER_PLACE = 25;
const failedTries = new Map(); // key -> { count, first, lockedUntil }

function personKey(ip, email) {
  return `person|${ip}|${email}`;
}

function placeKey(ip) {
  return `place|${ip}`;
}

function isLocked(key) {
  const entry = failedTries.get(key);
  if (!entry) return false;

  const now = Date.now();
  if (entry.lockedUntil > now) return true;

  // the wait is over, or the wrong tries were long ago: start again
  if (entry.lockedUntil || now - entry.first > LOCK_MINUTES * 60 * 1000) failedTries.delete(key);
  return false;
}

function recordFailure(key, max) {
  isLocked(key); // clears an old entry first
  const entry = failedTries.get(key) || { count: 0, first: Date.now(), lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= max) entry.lockedUntil = Date.now() + LOCK_MINUTES * 60 * 1000;
  failedTries.set(key, entry);
}

/* A new password was set for this email: they may try again at once. */
function clearFailuresFor(email) {
  const ending = `|${String(email).toLowerCase()}`;
  for (const key of failedTries.keys()) {
    if (key.startsWith("person|") && key.endsWith(ending)) failedTries.delete(key);
  }
}

/* ---------- What the dashboard may see about an account ---------- */

function publicUser(user) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    permissions: permissionsOf(user),
    department: user.department || "",
    active: user.active,
    lastLoginAt: user.lastLoginAt || null,
    createdAt: user.createdAt,
    // the owner account from backend/.env is changed there, not in the dashboard
    fromEnv: user.email === ownerEmailFromEnv(),
  };
}

/* ---------- Owner account from backend/.env ---------- */

async function ensureOwnerFromEnv() {
  const email = ownerEmailFromEnv();
  const password = process.env.ADMIN_PASSWORD || "";

  if (!email || !isEmail(email)) {
    console.warn("Admin sign-in: add ADMIN_EMAIL (the owner's email) to backend/.env.");
    return;
  }

  if (passwordProblem(password)) {
    console.warn(`Admin sign-in: ADMIN_PASSWORD in backend/.env must be at least ${MIN_PASSWORD} characters.`);
    return;
  }

  const name = text(process.env.ADMIN_NAME).slice(0, 80) || "Owner";
  const user = await AdminUser.findOne({ email });

  if (!user) {
    await AdminUser.create({
      name,
      email,
      passwordHash: await hashPassword(password),
      role: "owner",
      active: true,
    });
    console.log("Admin sign-in: owner account created from backend/.env.");
    return;
  }

  let changed = false;

  if (user.role !== "owner" || !user.active) {
    user.role = "owner";
    user.active = true;
    changed = true;
  }

  if (text(process.env.ADMIN_NAME) && user.name !== name) {
    user.name = name;
    changed = true;
  }

  if (!(await passwordMatches(password, user.passwordHash))) {
    user.passwordHash = await hashPassword(password);
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    changed = true;
  }

  if (changed) {
    await user.save();
    console.log("Admin sign-in: owner account updated from backend/.env.");
  }
}

/* ---------- Sign in ---------- */

async function login(req, res) {
  try {
    const ip = req.ip || "unknown";
    const body = req.body || {};
    const email = text(body.email).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please enter your email and password.",
      });
    }

    if (isLocked(personKey(ip, email))) {
      return res.status(429).json({
        success: false,
        message: `Too many wrong passwords for this email. Please wait ${LOCK_MINUTES} minutes, or ask the manager to reset your password.`,
      });
    }

    if (isLocked(placeKey(ip))) {
      return res.status(429).json({
        success: false,
        message: `Too many wrong tries from this place. Please wait ${LOCK_MINUTES} minutes and try again.`,
      });
    }

    if ((await AdminUser.estimatedDocumentCount()) === 0) {
      return res.status(503).json({
        success: false,
        message:
          "No admin account has been set up yet. Add ADMIN_EMAIL and ADMIN_PASSWORD (at least 8 characters) to backend/.env and restart the server.",
      });
    }

    const user = isEmail(email) ? await AdminUser.findOne({ email }) : null;
    const rightPassword = user
      ? await passwordMatches(password, user.passwordHash)
      : (await takeSameTime(password), false);

    if (!rightPassword) {
      recordFailure(personKey(ip, email), MAX_FAILED_TRIES);
      recordFailure(placeKey(ip), MAX_FAILED_PER_PLACE);
      return res.status(401).json({
        success: false,
        message: "That email or password isn't right.",
      });
    }

    failedTries.delete(personKey(ip, email));

    if (!user.active) {
      return res.status(403).json({
        success: false,
        message: "This account has been turned off. Please ask the manager or the owner of the inn.",
      });
    }

    user.lastLoginAt = new Date();
    await user.save();
    await audit(user, "sign-in", "Signed in");

    return res.status(200).json({
      success: true,
      token: makeToken(user),
      expiresInHours: TOKEN_HOURS,
      user: publicUser(user),
    });
  } catch (error) {
    console.error("Admin sign-in failed:", error.message);
    return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
}

/* ---------- Guards for admin routes ---------- */

/* Sends the person back to the sign-in page, saying why. */
function signedOut(res, message) {
  return res.status(401).json({ success: false, message });
}

async function requireAdmin(req, res, next) {
  try {
    const header = req.get("authorization") || "";
    const { data, why } = readToken(header.startsWith("Bearer ") ? header.slice(7) : "");

    if (!data) return signedOut(res, why);

    const user = await AdminUser.findById(data.uid);

    // removed, turned off or changed by the manager or the owner: out at once
    if (!user) {
      return signedOut(res, "Your account has been removed. Ask the manager or the owner if this is a mistake.");
    }
    if (!user.active) {
      return signedOut(res, "Your account has been turned off. Ask the manager or the owner.");
    }
    if ((user.tokenVersion || 0) !== data.v) {
      return signedOut(res, "Your account was changed by the manager or the owner (for example a new password). Please sign in again.");
    }

    req.admin = user;
    return next();
  } catch (error) {
    console.error("Admin check failed:", error.message);
    return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
}

function requireOwner(req, res, next) {
  if (!req.admin || req.admin.role !== "owner") {
    return res.status(403).json({
      success: false,
      message: "Only the owner can do this.",
    });
  }

  return next();
}

module.exports = {
  login,
  clearFailuresFor,
  requireAdmin,
  requireOwner,
  ensureOwnerFromEnv,
  hashPassword,
  passwordMatches,
  passwordProblem,
  isEmail,
  makeToken,
  publicUser,
  ownerEmailFromEnv,
};
