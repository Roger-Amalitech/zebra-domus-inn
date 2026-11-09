/* =========================================
   ZEBRA DORMUS INN
   Roles for the admin dashboard

   owner    purchases, budgets, approvals, money reports, audit log,
            rooms and prices, and everything a manager does
   manager  daily stock: checks purchases into the store, issues
            supplies, counts (differences wait for the owner),
            handles staff requests; bookings; adds staff
   staff    asks for supplies and confirms they received them;
            can't change stock numbers
========================================= */

const PERMISSIONS = [
  { key: "bookings.view", label: "See today, bookings and availability" },
  { key: "bookings.manage", label: "Confirm, cancel and mark bookings paid" },
  { key: "rooms.manage", label: "Change rooms, prices and online booking" },
  { key: "users.manage", label: "Add staff and manage their accounts" },
  { key: "stock.view", label: "See stock: in stock, used, remaining" },
  { key: "stock.items", label: "Add and change stock items" },
  { key: "stock.delete", label: "Delete stock items" },
  { key: "stock.issue", label: "Issue supplies to departments" },
  { key: "stock.count", label: "Count stock" },
  { key: "stock.approve", label: "Approve count differences" },
  { key: "stock.prices", label: "See prices, values and money reports" },
  { key: "purchases.view", label: "See purchases" },
  { key: "purchases.record", label: "Record and cancel purchases" },
  { key: "purchases.receive", label: "Check purchases into the store" },
  { key: "budget.manage", label: "Set monthly budgets" },
  { key: "requests.make", label: "Ask for supplies" },
  { key: "requests.manage", label: "Issue or turn down supply requests" },
  { key: "audit.view", label: "See the audit log" },
];

const ALL = PERMISSIONS.map((p) => p.key);

const ROLE_PERMISSIONS = {
  owner: ALL.filter((key) => key !== "requests.make"),
  manager: [
    "bookings.view",
    "bookings.manage",
    "users.manage",
    "stock.view",
    "stock.items",
    "stock.issue",
    "stock.count",
    "purchases.view",
    "purchases.receive",
    "requests.manage",
  ],
  staff: ["requests.make"],
};

const ROLES = Object.keys(ROLE_PERMISSIONS);

function permissionsOf(user) {
  if (!user) return [];
  return (ROLE_PERMISSIONS[user.role] || []).slice();
}

function can(user, key) {
  return Boolean(user && user.active !== false && permissionsOf(user).includes(key));
}

function isManager(user) {
  return Boolean(user && (user.role === "owner" || user.role === "manager"));
}

/* Who may change whose account:
   the owner changes managers and staff; a manager changes staff. */
function canManage(actor, target) {
  if (!actor || !target || String(actor._id) === String(target._id)) return false;
  if (target.role === "owner") return false;
  if (actor.role === "owner") return true;
  return actor.role === "manager" && target.role === "staff";
}

function denied(res, message) {
  return res.status(403).json({
    success: false,
    message: message || "Your role can't do this. Ask the manager or the owner.",
  });
}

/* Route guard: the signed-in person needs every permission listed. */
function requirePermission(...keys) {
  return (req, res, next) => {
    for (const key of keys) {
      if (!can(req.admin, key)) return denied(res);
    }
    return next();
  };
}

/* Route guard: the signed-in person needs at least one of them. */
function requireAny(...keys) {
  return (req, res, next) => {
    if (keys.some((key) => can(req.admin, key))) return next();
    return denied(res);
  };
}

function requireManager(req, res, next) {
  if (!can(req.admin, "users.manage")) return denied(res, "Only the manager or the owner can do this.");
  return next();
}

module.exports = {
  PERMISSIONS,
  ALL,
  ROLES,
  ROLE_PERMISSIONS,
  permissionsOf,
  can,
  isManager,
  canManage,
  denied,
  requirePermission,
  requireAny,
  requireManager,
};
