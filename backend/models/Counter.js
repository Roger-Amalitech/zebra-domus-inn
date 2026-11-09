const mongoose = require("mongoose");

/* Running numbers for references like P-0001 and R-0001. */
const counterSchema = new mongoose.Schema({
  _id: { type: String },
  seq: { type: Number, default: 0 },
});

module.exports = mongoose.model("Counter", counterSchema);
