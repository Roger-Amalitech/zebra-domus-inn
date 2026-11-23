/* =========================================
   ZEBRA DORMUS INN
   Two-step sign-in: the 6-digit codes of authenticator apps
   (Google Authenticator, Microsoft Authenticator...), the standard
   "time-based one-time password" (RFC 6238): a new code every 30 seconds,
   made from a secret shared once with the phone by a QR code.

   Also backup codes: 8 one-time codes for when the phone is lost.
   Only their fingerprints (SHA-256) are kept, never the codes themselves.
========================================= */

const crypto = require("crypto");

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // base32, what the apps read
const STEP_SECONDS = 30;
const DIGITS = 6;
const ISSUER = "Zebra Dormus Inn";

function toBase32(buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(text) {
  const clean = String(text || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/* A new secret: 20 random bytes, written for the apps (32 letters and digits). */
function newSecret() {
  return toBase32(crypto.randomBytes(20));
}

function currentStep(now = Date.now()) {
  return Math.floor(now / 1000 / STEP_SECONDS);
}

function codeAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hash = crypto.createHmac("sha1", fromBase32(secret)).update(counter).digest();
  const offset = hash[hash.length - 1] & 15;
  const number =
    ((hash[offset] & 0x7f) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];
  return String(number % 10 ** DIGITS).padStart(DIGITS, "0");
}

/* The code typed is right for now, 30 seconds before or after (a phone's clock
   can be a little off), and wasn't used already: returns its time step, or 0. */
function checkCode(secret, typed, lastUsedStep = 0) {
  const code = String(typed || "").replace(/\s/g, "");
  if (!secret || !/^\d{6}$/.test(code)) return 0;

  const now = currentStep();
  for (const step of [now - 1, now, now + 1]) {
    if (step <= lastUsedStep) continue; // a code works once
    const right = Buffer.from(codeAt(secret, step));
    if (crypto.timingSafeEqual(right, Buffer.from(code))) return step;
  }
  return 0;
}

/* What the QR code holds: the apps read it and add "Zebra Dormus Inn (email)". */
function setupLink(secret, account) {
  const label = encodeURIComponent(`${ISSUER}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

/* ---------- Backup codes ---------- */

const BACKUP_LETTERS = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o, 1/l/i to mix up
const BACKUP_COUNT = 8;

function cleanBackup(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function fingerprint(code) {
  return crypto.createHash("sha256").update(`zd-backup|${cleanBackup(code)}`).digest("hex");
}

/* 8 new codes like "k7pq2-mx9ta": the codes to show once, and what to keep. */
function newBackupCodes() {
  const codes = [];
  for (let i = 0; i < BACKUP_COUNT; i += 1) {
    let code = "";
    for (let j = 0; j < 10; j += 1) code += BACKUP_LETTERS[crypto.randomInt(BACKUP_LETTERS.length)];
    codes.push(`${code.slice(0, 5)}-${code.slice(5)}`);
  }
  return { codes, kept: codes.map(fingerprint) };
}

/* Returns the kept list without this code if it is one of them, otherwise null. */
function useBackupCode(kept, typed) {
  if (cleanBackup(typed).length !== 10) return null;
  const print = fingerprint(typed);
  const list = Array.isArray(kept) ? kept : [];
  const index = list.findIndex((item) => item.length === print.length && crypto.timingSafeEqual(Buffer.from(item), Buffer.from(print)));
  if (index < 0) return null;
  return list.filter((item, i) => i !== index);
}

module.exports = {
  newSecret,
  checkCode,
  codeAt,
  currentStep,
  setupLink,
  newBackupCodes,
  useBackupCode,
  BACKUP_COUNT,
  ISSUER,
};
