/* =========================================
   ZEBRA DOMUS INN
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

   Two-step sign-in (utils/totp.js): after the password, a 6-digit code
   from an authenticator app on the phone. The owner must use it; managers
   and staff can turn it on in My account. A lost phone: a backup code, or
   the owner (or a manager, for staff) turns it off for that person. The
   owner's own phone lost and no backup code: on Render set
   ADMIN_RESET_TWO_STEP=yes, deploy, sign in and set it up again, then
   remove that setting.

   New passwords must be at least 10 characters and not easy to guess
   (common passwords, the inn's name with numbers, the person's own name).
========================================= */

const crypto = require("crypto");
const { promisify } = require("util");
const mongoose = require("mongoose");

const AdminUser = require("../models/AdminUser");
const { permissionsOf } = require("./permissions");
const { audit } = require("./audit");
const totp = require("./totp");

const scrypt = promisify(crypto.scrypt);

const TOKEN_HOURS = 12;
const TICKET_MINUTES = 10; // time to type the code after the password
const MAX_FAILED_TRIES = 5;
const MAX_WRONG_CODES = 5;
const LOCK_MINUTES = 15;
const MIN_PASSWORD = 10;
const OWNER_ENV_MIN_PASSWORD = 8; // the owner's password on Render still works from 8, with a warning
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

/* ---------- Password rules ---------- */

// Words a guesser tries first, with numbers or symbols around them.
const EASY_WORDS = new Set([
  "password", "passw", "passwd", "pass", "admin", "administrator", "root", "welcome", "letmein", "login",
  "qwerty", "qwertyuiop", "qwertz", "azerty", "asdf", "asdfgh", "asdfghjkl", "zxcvbn", "zxcvbnm",
  "iloveyou", "love", "monkey", "dragon", "sunshine", "princess", "football", "baseball", "master",
  "shadow", "superman", "batman", "trustno", "changeme", "secret", "hello", "test", "guest", "user",
  "god", "jesus", "abc", "abcd", "abcdef", "abcdefg", "abcdefgh", "family", "mama", "papa",
  "hotel", "motel", "inn", "manager", "owner", "staff", "reception", "booking", "bookings", "dashboard",
  "zebra", "zebras", "dormus", "domus", "zebradormus", "zebradomus", "zebradormusinn", "zebradomusinn",
  "huye", "butare", "rwanda", "kigali", "africa", "amahoro", "murakoze", "imana", "amalitech",
  "greenhaven", "greenhavenmotel",
]);

const SEQUENCES = [
  "01234567890123456789",
  "98765432109876543210",
  "abcdefghijklmnopqrstuvwxyz",
  "zyxwvutsrqponmlkjihgfedcba",
  "qwertyuiopasdfghjklzxcvbnm",
  "1qaz2wsx3edc4rfv5tgb",
  "q1w2e3r4t5y6u7i8o9p0",
  "1q2w3e4r5t6y7u8i9o0p",
];

function lettersOf(value) {
  return String(value || "").toLowerCase().replace(/[^a-z]/g, "");
}

/* Returns a message if the password is too weak, otherwise "".
   who: { name, email } of the account, so its own name isn't the password. */
function passwordProblem(password, who = {}) {
  const tip = "Try a short sentence that is easy for you to remember, like: blue gate opens at seven.";

  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    return `The password must be at least ${MIN_PASSWORD} characters. ${tip}`;
  }
  if (password.length > MAX_PASSWORD) {
    return `The password can be up to ${MAX_PASSWORD} characters.`;
  }

  const lower = password.toLowerCase();
  const letters = lettersOf(password);
  const easy = `This password is too easy to guess. ${tip}`;

  if (new Set(lower).size < 4) return easy; // aaaaaaaaaa, 1212121212
  if (!letters) return `Please use letters too, not only numbers and symbols. ${tip}`;
  if (SEQUENCES.some((run) => run.includes(lower.replace(/\s/g, "")))) return easy; // 1234567890, qwertyuiop
  if (EASY_WORDS.has(letters)) return easy; // Password123!, Zebra2026, Kigali@2025

  // the person's own name or email with numbers around it
  const own = [lettersOf(who.name), lettersOf(String(who.email || "").split("@")[0])];
  String(who.name || "").split(/\s+/).forEach((part) => own.push(lettersOf(part)));
  if (own.some((word) => word.length >= 3 && letters === word)) return easy;

  return "";
}

/* The owner's password on Render: kept working from 8 characters,
   but the dashboard asks the owner to make it stronger. */
let ownerPasswordWeak = false;

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

/* A ticket: proof the password was right, for the next step only
   ("code": type the 6-digit code; "setup": set up two-step sign-in).
   It lasts 10 minutes and can't be used as a sign-in token. */
function makeTicket(user, purpose) {
  const payload = Buffer.from(
    JSON.stringify({
      uid: String(user._id),
      v: user.tokenVersion || 0,
      p: purpose,
      exp: Date.now() + TICKET_MINUTES * 60 * 1000,
    })
  ).toString("base64url");

  return `${payload}.${sign(payload)}`;
}

function readTicket(ticket, purpose) {
  const again = `Please sign in again with your email and password.`;
  if (typeof ticket !== "string" || !ticket.includes(".")) return { why: again };

  const [payload, signature] = ticket.split(".");
  if (!payload || !signature) return { why: again };

  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return { why: again };

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data.p !== purpose || !mongoose.isValidObjectId(data.uid)) return { why: again };
    if (!(Number(data.exp) > Date.now())) {
      return { why: `That took more than ${TICKET_MINUTES} minutes. ${again}` };
    }
    return { data };
  } catch (error) {
    return { why: again };
  }
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
    if (data.p !== undefined) return { why: "Please sign in again." }; // a ticket, not a sign-in
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

/* Returns true when this failure starts a wait (so the owner can be told). */
function recordFailure(key, max) {
  isLocked(key); // clears an old entry first
  const entry = failedTries.get(key) || { count: 0, first: Date.now(), lockedUntil: 0 };
  entry.count += 1;
  const startsWait = entry.count === max;
  if (entry.count >= max) entry.lockedUntil = Date.now() + LOCK_MINUTES * 60 * 1000;
  failedTries.set(key, entry);
  return startsWait;
}

// Old entries are cleared every 10 minutes, so the list never grows without end.
const tidy = setInterval(() => {
  for (const key of [...failedTries.keys()]) isLocked(key);
}, 10 * 60 * 1000);
if (tidy.unref) tidy.unref();

/* Written to the audit log (Audit tab, owner), so the owner sees someone guessing. */
const SECURITY = { name: "Security alert", role: "" };

function securityAlert(text) {
  return audit(SECURITY, "sign-in", text);
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
    twoStep: { on: Boolean(user.twoStepOn), required: twoStepRequired(user) },
    // the owner's password on Render is easy to guess: the dashboard asks to change it
    passwordWeak: user.email === ownerEmailFromEnv() && ownerPasswordWeak,
  };
}

/* ---------- Two-step sign-in ---------- */

function twoStepRequired(user) {
  return user.role === "owner";
}

const SECRET_FIELDS = "+totpSecret +totpPending +totpLastStep +backupCodes";

function withSecrets(id) {
  return AdminUser.findById(id).select(SECRET_FIELDS);
}

/* Step 1 of setting up: a new secret for the phone (kept "pending" until a
   code from the phone proves it was added). */
async function startTwoStep(user) {
  const secret = totp.newSecret();
  await AdminUser.updateOne({ _id: user._id }, { $set: { totpPending: secret } });
  return { secret, link: totp.setupLink(secret, user.email), account: user.email };
}

/* Step 2: the first code from the phone. Returns { codes } (new backup codes)
   or { why }. */
async function confirmTwoStep(userId, code) {
  const user = await withSecrets(userId);
  if (!user || !user.totpPending) return { why: "Please start again: press Set up two-step sign-in." };

  const step = totp.checkCode(user.totpPending, code, 0);
  if (!step) {
    return { why: "That code isn't right. Check the phone's time is set automatically, and type the newest 6-digit code." };
  }

  const backup = totp.newBackupCodes();
  user.totpSecret = user.totpPending;
  user.totpPending = "";
  user.totpLastStep = step;
  user.backupCodes = backup.kept;
  user.twoStepOn = true;
  user.twoStepSince = new Date();
  await user.save();
  await audit(user, "sign-in", "Turned on two-step sign-in");
  return { user, codes: backup.codes };
}

/* A code at sign-in (or to make new backup codes): a code from the app,
   or one of the backup codes. Returns "app", "backup" or "". */
async function useCode(user, typed) {
  const step = totp.checkCode(user.totpSecret, typed, user.totpLastStep || 0);
  if (step) {
    user.totpLastStep = step;
    await user.save();
    return "app";
  }

  const left = totp.useBackupCode(user.backupCodes, typed);
  if (left) {
    user.backupCodes = left;
    await user.save();
    await audit(user, "sign-in", `Used a backup code (${left.length} left)`);
    return "backup";
  }

  return "";
}

/* Turned off: the secrets are cleared. Signing in then needs only the password
   (the owner is asked to set it up again at the next sign-in). */
async function clearTwoStep(userId) {
  await AdminUser.updateOne(
    { _id: userId },
    { $set: { twoStepOn: false, totpSecret: "", totpPending: "", totpLastStep: 0, backupCodes: [] }, $unset: { twoStepSince: 1 } }
  );
}

async function newBackupCodesFor(user) {
  const backup = totp.newBackupCodes();
  await AdminUser.updateOne({ _id: user._id }, { $set: { backupCodes: backup.kept } });
  await audit(user, "sign-in", "Made new backup codes");
  return backup.codes;
}

async function backupCodesLeft(userId) {
  const user = await withSecrets(userId);
  return user && Array.isArray(user.backupCodes) ? user.backupCodes.length : 0;
}

/* ---------- Owner account from backend/.env ---------- */

async function ensureOwnerFromEnv() {
  const email = ownerEmailFromEnv();
  const password = process.env.ADMIN_PASSWORD || "";

  if (!email || !isEmail(email)) {
    console.warn("Admin sign-in: add ADMIN_EMAIL (the owner's email) to backend/.env.");
    return;
  }

  if (typeof password !== "string" || password.length < OWNER_ENV_MIN_PASSWORD || password.length > MAX_PASSWORD) {
    console.warn(`Admin sign-in: ADMIN_PASSWORD in backend/.env must be at least ${OWNER_ENV_MIN_PASSWORD} characters.`);
    return;
  }

  const name = text(process.env.ADMIN_NAME).slice(0, 80) || "Owner";
  ownerPasswordWeak = Boolean(passwordProblem(password, { name, email }));
  if (ownerPasswordWeak) {
    console.warn("Admin sign-in: ADMIN_PASSWORD is easy to guess. Please choose a longer one (see the dashboard).");
  }

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

  // The owner lost the phone and the backup codes: ADMIN_RESET_TWO_STEP=yes on Render
  if (text(process.env.ADMIN_RESET_TWO_STEP).toLowerCase() === "yes" && user.twoStepOn) {
    await clearTwoStep(user._id);
    await AdminUser.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });
    await securityAlert(`Two-step sign-in was reset for ${user.name} with the ADMIN_RESET_TWO_STEP setting on the server`);
    console.warn("Admin sign-in: two-step sign-in reset for the owner. Remove ADMIN_RESET_TWO_STEP now.");
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
      if (recordFailure(personKey(ip, email), MAX_FAILED_TRIES)) {
        await securityAlert(`Sign-in stopped for ${LOCK_MINUTES} minutes: ${MAX_FAILED_TRIES} wrong passwords for ${email.slice(0, 120)} from internet address ${ip}`);
      }
      if (recordFailure(placeKey(ip), MAX_FAILED_PER_PLACE)) {
        await securityAlert(`Sign-in stopped for ${LOCK_MINUTES} minutes for internet address ${ip}: ${MAX_FAILED_PER_PLACE} wrong tries (someone may be guessing)`);
      }
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

    // the password was right: next, the code from the phone (or set it up)
    if (user.twoStepOn) {
      return res.json({ success: true, step: "code", ticket: makeTicket(user, "code"), name: user.name });
    }
    if (twoStepRequired(user)) {
      return res.json({ success: true, step: "setup", ticket: makeTicket(user, "setup"), name: user.name });
    }

    return finishSignIn(res, user, "Signed in");
  } catch (error) {
    console.error("Admin sign-in failed:", error.message);
    return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
}

async function finishSignIn(res, user, said, extra = {}) {
  user.lastLoginAt = new Date();
  await AdminUser.updateOne({ _id: user._id }, { $set: { lastLoginAt: user.lastLoginAt } });
  await audit(user, "sign-in", said);

  return res.status(200).json({
    success: true,
    token: makeToken(user),
    expiresInHours: TOKEN_HOURS,
    user: publicUser(user),
    ...extra,
  });
}

/* The ticket's account, still allowed in (not turned off, password not changed). */
async function ticketUser(req, res, purpose) {
  const body = req.body || {};
  const { data, why } = readTicket(body.ticket, purpose);
  if (!data) {
    res.status(401).json({ success: false, code: "SIGN_IN_AGAIN", message: why });
    return null;
  }

  const user = await withSecrets(data.uid);
  if (!user || !user.active || (user.tokenVersion || 0) !== data.v) {
    res.status(401).json({ success: false, code: "SIGN_IN_AGAIN", message: "Please sign in again with your email and password." });
    return null;
  }
  return user;
}

/* Sign in, step 2: the 6-digit code (or a backup code). */
async function loginCode(req, res) {
  try {
    const user = await ticketUser(req, res, "code");
    if (!user) return undefined;

    const key = `code|${user._id}`;
    if (isLocked(key)) {
      return res.status(429).json({
        success: false,
        message: `Too many wrong codes. Please wait ${LOCK_MINUTES} minutes, then sign in again.`,
      });
    }

    const used = await useCode(user, (req.body || {}).code);
    if (!used) {
      if (recordFailure(key, MAX_WRONG_CODES)) {
        await securityAlert(`Sign-in stopped for ${LOCK_MINUTES} minutes: ${MAX_WRONG_CODES} wrong two-step codes for ${user.email} (the password was right) from internet address ${req.ip || "unknown"}`);
      }
      return res.status(401).json({
        success: false,
        message: "That code isn't right. Type the newest 6-digit code from the app, or one of your backup codes.",
      });
    }

    failedTries.delete(key);
    failedTries.delete(personKey(req.ip || "unknown", user.email));

    const left = used === "backup" ? user.backupCodes.length : null;
    return finishSignIn(res, user, used === "backup" ? "Signed in with a backup code" : "Signed in", {
      backupCodesLeft: left,
    });
  } catch (error) {
    console.error("Two-step sign-in failed:", error.message);
    return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
}

/* Sign in when two-step sign-in must be set up first (the owner). */
async function loginSetupStart(req, res) {
  try {
    const user = await ticketUser(req, res, "setup");
    if (!user) return undefined;
    if (user.twoStepOn) {
      return res.status(409).json({ success: false, code: "SIGN_IN_AGAIN", message: "Two-step sign-in is already on. Please sign in again." });
    }
    return res.json({ success: true, ...(await startTwoStep(user)) });
  } catch (error) {
    console.error("Two-step setup failed:", error.message);
    return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
}

async function loginSetupConfirm(req, res) {
  try {
    const user = await ticketUser(req, res, "setup");
    if (!user) return undefined;

    const key = `code|${user._id}`;
    if (isLocked(key)) {
      return res.status(429).json({ success: false, message: `Too many wrong codes. Please wait ${LOCK_MINUTES} minutes.` });
    }

    const done = await confirmTwoStep(user._id, (req.body || {}).code);
    if (done.why) {
      recordFailure(key, MAX_WRONG_CODES);
      return res.status(400).json({ success: false, message: done.why });
    }

    failedTries.delete(key);
    return finishSignIn(res, done.user, "Signed in", { backupCodes: done.codes });
  } catch (error) {
    console.error("Two-step setup failed:", error.message);
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
  loginCode,
  loginSetupStart,
  loginSetupConfirm,
  startTwoStep,
  confirmTwoStep,
  useCode,
  clearTwoStep,
  newBackupCodesFor,
  backupCodesLeft,
  withSecrets,
  twoStepRequired,
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
