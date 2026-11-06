const mongoose = require("mongoose");

const STOCK_CATEGORIES = [
  "Toiletries",
  "Bed linen & towels",
  "Drinks",
  "Food & kitchen",
  "Cleaning",
  "Maintenance",
  "Office",
  "Other",
];

/* Something the inn keeps in store: soap, towels, water... */
const stockItemSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    // lower-case name, so "Soap" and "soap" can't both exist
    nameKey: {
      type: String,
      required: true,
      unique: true,
    },
    category: {
      type: String,
      enum: STOCK_CATEGORIES,
      default: "Other",
    },
    // what it is counted in: rolls, bottles, pieces, kg...
    unit: {
      type: String,
      trim: true,
      maxlength: 20,
      default: "pieces",
    },
    // how many there are now
    quantity: {
      type: Number,
      min: 0,
      default: 0,
    },
    // warn when the quantity is at or below this
    lowStockAt: {
      type: Number,
      min: 0,
      default: 0,
    },
    // what one costs to buy, in RWF (only the owner sees it)
    unitCost: {
      type: Number,
      min: 0,
      default: 0,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 300,
      default: "",
    },
    // archived items are kept for the reports but no longer used
    active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("StockItem", stockItemSchema);
module.exports.STOCK_CATEGORIES = STOCK_CATEGORIES;
