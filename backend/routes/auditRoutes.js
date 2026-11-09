/* =========================================
   ZEBRA DORMUS INN
   Audit log (owner only), mounted at /api/admin/audit

   GET /   ?area=stock|purchases|requests|budget|bookings|rooms|users|sign-in
           &q=text &before=ISO date   newest first, 100 at a time
========================================= */

const express = require("express");

const AuditLog = require("../models/AuditLog");
const { AUDIT_AREAS } = AuditLog;

const router = express.Router();

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

    const before = req.query.before ? new Date(req.query.before) : null;
    if (before && !Number.isNaN(before.getTime())) filter.createdAt = { $lt: before };

    const entries = await AuditLog.find(filter).sort({ createdAt: -1, _id: -1 }).limit(100).lean();

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

module.exports = router;
