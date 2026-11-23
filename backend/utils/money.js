/* =========================================
   ZEBRA DOMUS INN
   Money: the ways customers pay, the accounts the money lands in,
   and the "money in" record kept for every payment received.

   Accounts: cash (at the inn), MTN MoMo, Airtel Money, bank (card and bank transfers).
   Money in is written automatically when a booking or event is marked paid,
   when a sale is paid, and when a debt payment comes in; and by hand for anything else.
========================================= */

const MoneyIn = require("../models/MoneyIn");
const { nextRef } = require("./stockOps");

const METHODS = ["cash", "momo", "airtel", "card", "bank"];
const METHOD_NAMES = { cash: "cash", momo: "MTN MoMo", airtel: "Airtel Money", card: "card", bank: "bank transfer" };
const ACCOUNTS = ["cash", "momo", "airtel", "bank"];
const ACCOUNT_NAMES = { cash: "Cash", momo: "MTN MoMo", airtel: "Airtel Money", bank: "Bank" };

// card payments land in the bank
function accountOf(method) {
  if (method === "card") return "bank";
  return ACCOUNTS.includes(method) ? method : "cash";
}

// how a website booking said it would pay, as a payment method
function methodOfBooking(paymentMethod) {
  return { "MTN Mobile Money": "momo", "Airtel Money": "airtel", "Visa/Mastercard": "card" }[paymentMethod] || "cash";
}

/* Saves money received. source: booking | event | sale | debt | other.
   income: rooms | events | sales | other, or "" when the money is not new income
   (a sale is counted as income when it is made; paying for a sale later is not counted again). */
async function recordMoneyIn({ person, amount, day, method, source, sourceId, sourceRef, income, description, customerName, note }) {
  return MoneyIn.create({
    ref: await nextRef("M"),
    amount,
    day,
    method,
    account: accountOf(method),
    source,
    sourceId: sourceId || undefined,
    sourceRef: sourceRef || "",
    income: income || "",
    description: description || "",
    customerName: customerName || "",
    note: note || "",
    createdBy: person ? person._id : undefined,
    createdByName: person ? person.name : "",
  });
}

// takes back money in that was recorded by mistake (for example a booking marked "not paid" again)
async function voidMoneyIn(filter, person, reason) {
  const entries = await MoneyIn.find({ ...filter, status: "active" }).lean();
  if (!entries.length) return [];
  await MoneyIn.updateMany(
    { _id: { $in: entries.map((e) => e._id) } },
    { $set: { status: "void", voidReason: reason || "", voidedByName: person ? person.name : "", voidedAt: new Date() } }
  );
  return entries;
}

module.exports = { METHODS, METHOD_NAMES, ACCOUNTS, ACCOUNT_NAMES, accountOf, methodOfBooking, recordMoneyIn, voidMoneyIn };
