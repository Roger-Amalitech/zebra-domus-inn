/* =========================================
   ZEBRA DORMUS INN
   Roles and permissions for the admin dashboard

   owner    can do everything, and manages managers and staff
   manager  manages staff accounts and ticks what each one may do;
            does what the owner ticked for them (all, to start with)
   staff    does only what a manager or the owner ticked (nothing, to start with)

   A manager can only give staff the things they can do themselves.
========================================= */

const PERMISSIONS = [
  { key: "bookings.view", group: "Bookings", label: "See today, bookings and availability" },
  { key: "bookings.manage", group: "Bookings", label: "Confirm, cancel and mark bookings paid", needs: "bookings.view" },
  { key: "stock.view", group: "Stock", label: "See stock: in stock, used, remaining" },
  { key: "stock.use", group: "Stock", label: "Record what was used", needs: "stock.view" },
  { key: "stock.receive", group: "Stock", label: "Record what came in", needs: "stock.view" },
  { key: "stock.count", group: "Stock", label: "Correct numbers after counting", needs: "stock.view" },
  { key: "stock.items", group: "Stock", label: "Add, change and delete items", needs: "stock.view" },
  { key: "stock.prices", group: "Stock", label: "See prices and value", needs: "stock.view" },
  { key: "rooms.manage", group: "Rooms", label: "Change rooms, prices and online booking" },
];

const ALL = PERMISSIONS.map((p) => p.key);

const ROLES = ["owner", "manager", "staff"];

/* What staff could do before roles existed. Accounts made then keep it
   until a manager or the owner changes their permissions. */
const EARLIER_STAFF = ["bookings.view", "bookings.manage", "stock.view", "stock.use", "stock.receive", "stock.count"];

/* Keeps known permissions only, in a fixed order, and adds what they need
   (recording what was used needs seeing the stock, and so on). */
function normalize(list) {
  const wanted = new Set(Array.isArray(list) ? list.filter((key) => typeof key === "string") : []);

  PERMISSIONS.forEach((p) => {
    if (wanted.has(p.key) && p.needs) wanted.add(p.needs);
  });

  return ALL.filter((key) => wanted.has(key));
}

function permissionsOf(user) {
  if (!user) return [];
  if (user.role === "owner") return ALL.slice();
  if (Array.isArray(user.permissions)) return normalize(user.permissions);
  return user.role === "manager" ? ALL.slice() : EARLIER_STAFF.slice();
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

/* The permissions a person may hand out: the owner any, a manager their own. */
function grantable(actor) {
  return actor && actor.role === "owner" ? ALL.slice() : permissionsOf(actor);
}

/* A manager's ticks only change what they could give themselves; anything
   else the person already had (given by the owner) stays as it was. */
function mergeGrant(actor, current, wanted) {
  const mine = new Set(grantable(actor));
  const result = new Set();

  normalize(wanted).forEach((key) => {
    if (mine.has(key)) result.add(key);
  });
  normalize(current).forEach((key) => {
    if (!mine.has(key)) result.add(key);
  });

  return normalize([...result]);
}

function denied(res, message) {
  return res.status(403).json({
    success: false,
    message: message || "You don't have permission to do this. Ask the manager.",
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

function requireManager(req, res, next) {
  if (!isManager(req.admin)) return denied(res, "Only the manager or the owner can do this.");
  return next();
}

module.exports = {
  PERMISSIONS,
  ALL,
  ROLES,
  EARLIER_STAFF,
  normalize,
  permissionsOf,
  can,
  isManager,
  canManage,
  grantable,
  mergeGrant,
  denied,
  requirePermission,
  requireManager,
};
