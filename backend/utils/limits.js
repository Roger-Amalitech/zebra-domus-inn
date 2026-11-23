/* =========================================
   ZEBRA DORMUS INN
   Simple limits on how often something may happen, kept in the server's memory.

     const perHour = makeLimit(5, 60 * 60 * 1000);
     if (perHour.full(req.ip)) -> say "too many, try later"
     perHour.add(req.ip)       -> count one more

   A restart (Render waking up, a deploy) starts every count again, which is
   fine for stopping floods. Old counts are cleared every 10 minutes so the
   memory never fills up.
========================================= */

const limits = [];

function makeLimit(max, windowMs) {
  const hits = new Map(); // key -> times (ms) inside the window

  function recent(key, now) {
    const list = (hits.get(key) || []).filter((time) => now - time < windowMs);
    if (list.length) hits.set(key, list);
    else hits.delete(key);
    return list;
  }

  const limit = {
    full(key) {
      return recent(String(key), Date.now()).length >= max;
    },
    add(key) {
      const now = Date.now();
      const list = recent(String(key), now);
      list.push(now);
      hits.set(String(key), list);
    },
    // minutes until the oldest counted time drops out of the window
    minutesLeft(key) {
      const list = recent(String(key), Date.now());
      if (!list.length) return 0;
      return Math.max(1, Math.ceil((list[0] + windowMs - Date.now()) / 60000));
    },
    prune() {
      const now = Date.now();
      for (const key of [...hits.keys()]) recent(key, now);
    },
    size() {
      return hits.size;
    },
  };

  limits.push(limit);
  return limit;
}

const cleaner = setInterval(() => limits.forEach((limit) => limit.prune()), 10 * 60 * 1000);
if (cleaner.unref) cleaner.unref();

/* A hidden form field that people never see or fill in. Programs that fill in
   every field they find (spam robots) fill it in, and are turned away. */
const TRAP_FIELD = "leave_empty";

function filledTrap(body) {
  const value = body && body[TRAP_FIELD];
  return value !== undefined && value !== null && String(value).trim() !== "";
}

/* "0788 555 666", "+250 788 555 666" and "0788555666" are the same phone:
   the last 9 digits. */
function phoneKey(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.slice(-9);
}

module.exports = { makeLimit, TRAP_FIELD, filledTrap, phoneKey };
