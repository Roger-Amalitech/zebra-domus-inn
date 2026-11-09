/* =========================================
   ZEBRA DORMUS INN
   Monthly budgets per stock category, and what was spent.
   Spending = purchases the owner recorded that month (not cancelled).
========================================= */

const Budget = require("../models/Budget");
const Purchase = require("../models/Purchase");
const { STOCK_CATEGORIES } = require("../models/StockItem");

function validMonth(month) {
  return typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

// first day of the month and first day of the next, as UTC midnights
function monthRange(month) {
  const [year, mon] = month.split("-").map(Number);
  return { from: new Date(Date.UTC(year, mon - 1, 1)), to: new Date(Date.UTC(year, mon, 1)) };
}

function previousMonth(month) {
  const [year, mon] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, mon - 2, 1));
  return date.toISOString().slice(0, 7);
}

async function spentByCategory(month, exceptPurchaseId) {
  const { from, to } = monthRange(month);
  const match = { status: { $ne: "cancelled" }, day: { $gte: from, $lt: to } };
  if (exceptPurchaseId) match._id = { $ne: exceptPurchaseId };

  const rows = await Purchase.aggregate([
    { $match: match },
    { $unwind: "$lines" },
    {
      $group: {
        _id: "$lines.category",
        spent: { $sum: { $multiply: ["$lines.quantity", "$lines.unitCost"] } },
      },
    },
  ]);

  return new Map(rows.map((row) => [row._id, Math.round(row.spent)]));
}

async function budgetsFor(month) {
  const rows = await Budget.find({ month }).lean();
  return new Map(rows.map((row) => [row.category, row.amount]));
}

/* Every category with its budget and spending for the month. */
async function monthOverview(month) {
  const [budgets, spent] = await Promise.all([budgetsFor(month), spentByCategory(month)]);

  const rows = STOCK_CATEGORIES.map((category) => ({
    category,
    budget: budgets.has(category) ? budgets.get(category) : null,
    spent: spent.get(category) || 0,
  }));

  return {
    month,
    rows,
    totalBudget: rows.reduce((sum, row) => sum + (row.budget || 0), 0),
    totalSpent: rows.reduce((sum, row) => sum + row.spent, 0),
    hasBudget: budgets.size > 0,
  };
}

/* Which categories a purchase would push over their budget. */
async function overBudget(month, purchaseLines) {
  const [budgets, spent] = await Promise.all([budgetsFor(month), spentByCategory(month)]);
  const adding = new Map();

  purchaseLines.forEach((line) => {
    adding.set(line.category, (adding.get(line.category) || 0) + line.quantity * line.unitCost);
  });

  const warnings = [];

  adding.forEach((add, category) => {
    if (!budgets.has(category)) return;
    const budget = budgets.get(category);
    const after = (spent.get(category) || 0) + add;
    if (after > budget) warnings.push({ category, budget, spent: Math.round(after), over: Math.round(after - budget) });
  });

  return warnings;
}

module.exports = { validMonth, monthRange, previousMonth, spentByCategory, budgetsFor, monthOverview, overBudget };
