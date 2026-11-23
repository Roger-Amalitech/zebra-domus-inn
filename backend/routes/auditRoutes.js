/* =========================================
   ZEBRA DOMUS INN
   Audit log (owner only), mounted at /api/admin/audit

   GET /          ?area=stock|purchases|requests|budget|bookings|events|rooms|users|sign-in
                  &q=text &from=YYYY-MM-DD &to=YYYY-MM-DD (Rwanda days) &before=ISO date
                  newest first, 100 at a time (&all=1: the whole period, for the download)
   GET /summary   ?from=YYYY-MM-DD &to=YYYY-MM-DD   who did how much, by area, in the period
========================================= */

const express = require("express");

const AuditLog = require("../models/AuditLog");
const { AUDIT_AREAS } = AuditLog;

const router = express.Router();

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MOST_AT_ONCE = 5000;
const SECURITY_NAME = "Security alert";

// the start of a Rwanda day (UTC+2, no summer time), or null for a bad date
function rwandaDayStart(text) {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const start = new Date(`${text}T00:00:00+02:00`);
  return Number.isNaN(start.getTime()) ? null : start;
}

// { $gte, $lt } for the days asked for (either end may be left open)
function periodFilter(query) {
  const from = rwandaDayStart(query.from);
  const to = rwandaDayStart(query.to);
  const range = {};
  if (from) range.$gte = from;
  if (to) range.$lt = new Date(to.getTime() + DAY_MS);
  return Object.keys(range).length ? range : null;
}

router.get("/", async (req, res) => {
  try {
    const filter = {};

    if (AUDIT_AREAS.includes(req.query.area)) filter.area = req.query.area;

    const search = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60) : "";
    if (search) {
      const pattern = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ action: pattern }, { userName: pattern }];
    }

    const period = periodFilter(req.query);
    if (period) filter.createdAt = { ...period };

    const before = req.query.before ? new Date(req.query.before) : null;
    if (before && !Number.isNaN(before.getTime())) {
      filter.createdAt = filter.createdAt || {};
      if (!filter.createdAt.$lt || before < filter.createdAt.$lt) filter.createdAt.$lt = before;
    }

    const limit = req.query.all === "1" && period ? MOST_AT_ONCE : 100;
    const entries = await AuditLog.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();

    return res.json({
      success: true,
      areas: AUDIT_AREAS,
      entries: entries.map((entry) => ({
        _id: entry._id,
        area: entry.area,
        action: entry.action,
        userName: entry.userName,
        role: entry.role,
        createdAt: entry.createdAt,
      })),
    });
  } catch (error) {
    console.error("Audit log failed:", error.message);
    return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

/* Who did how much in the period: changes per person and per area, sign-ins and security alerts.
   A sign-in ("Signed in…") is not counted as a change; turning two-step on or off is. */
router.get("/summary", async (req, res) => {
  try {
    const period = periodFilter(req.query);
    const match = period ? { createdAt: period } : {};

    const groups = await AuditLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            name: "$userName",
            role: "$role",
            area: "$area",
            signIn: { $eq: [{ $substrCP: ["$action", 0, 9] }, "Signed in"] },
          },
          count: { $sum: 1 },
        },
      },
    ]);

    const people = new Map();
    const byArea = {};
    let total = 0;
    let signIns = 0;
    let securityAlerts = 0;

    groups.forEach((group) => {
      const { name, role, area, signIn } = group._id;
      total += group.count;
      byArea[area] = (byArea[area] || 0) + group.count;

      if (name === SECURITY_NAME) {
        securityAlerts += group.count;
        return;
      }
      const key = `${name}|${role}`;
      const person = people.get(key) || { name: name || "Someone", role: role || "", signIns: 0, changes: 0, areas: {} };
      if (signIn) {
        signIns += group.count;
        person.signIns += group.count;
      } else {
        person.changes += group.count;
        person.areas[area] = (person.areas[area] || 0) + group.count;
      }
      people.set(key, person);
    });

    return res.json({
      success: true,
      from: req.query.from || "",
      to: req.query.to || "",
      total,
      changes: total - signIns - securityAlerts,
      signIns,
      securityAlerts,
      byArea,
      byPerson: [...people.values()].sort((a, b) => b.changes - a.changes || b.signIns - a.signIns || a.name.localeCompare(b.name)),
    });
  } catch (error) {
    console.error("Audit summary failed:", error.message);
    return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

module.exports = router;
