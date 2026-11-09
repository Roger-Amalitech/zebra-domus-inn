/* =========================================
   ZEBRA DORMUS INN
   The audit log: one line for every change, with who made it.
   Writing it never stops the change itself from working.
========================================= */

const AuditLog = require("../models/AuditLog");

async function audit(person, area, action) {
  try {
    await AuditLog.create({
      area,
      action: String(action).slice(0, 300),
      userId: person ? person._id : undefined,
      userName: person ? person.name : "",
      role: person ? person.role : "",
    });
  } catch (error) {
    console.error("Audit log failed:", error.message);
  }
}

module.exports = { audit };
