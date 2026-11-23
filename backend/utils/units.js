/* =========================================
   ZEBRA DOMUS INN
   The units stock is counted in.
   Weight and volume can have decimals (2.5 kg); counted things
   are whole numbers (you can't issue 2.5 bottles).
========================================= */

const UNIT_GROUPS = [
  { group: "Weight", units: ["kg", "g"] },
  { group: "Volume", units: ["litres", "ml"] },
  {
    group: "Counted",
    units: ["pieces", "bottles", "cans", "rolls", "bars", "packs", "boxes", "bags", "sachets", "trays", "kits", "sets", "pairs", "bundles"],
  },
];

const WHOLE_UNITS = UNIT_GROUPS[2].units;
const ALL_UNITS = UNIT_GROUPS.reduce((all, group) => all.concat(group.units), []);

/* The unit as it is written in the list ("KG" -> "kg"), or "" if it isn't in the list. */
function knownUnit(unit) {
  const wanted = String(unit || "").trim().toLowerCase();
  return ALL_UNITS.find((u) => u === wanted) || "";
}

function isWholeUnit(unit) {
  return WHOLE_UNITS.includes(String(unit || "").trim().toLowerCase());
}

/* A message if this amount can't be used for this item, otherwise "". */
function wholeNumberProblem(name, unit, quantity) {
  if (isWholeUnit(unit) && !Number.isInteger(Number(quantity))) {
    return `${name} is counted in ${unit}: please use a whole number.`;
  }
  return "";
}

module.exports = { UNIT_GROUPS, WHOLE_UNITS, ALL_UNITS, knownUnit, isWholeUnit, wholeNumberProblem };
