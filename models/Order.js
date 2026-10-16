const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema(
  {
    id: mongoose.Schema.Types.Mixed,
    productId: mongoose.Schema.Types.Mixed,
    variantId: mongoose.Schema.Types.Mixed,
    name: String,
    weight: String,
    image: String,
    price: Number,
    unitPricePaise: Number,
    quantity: Number,
    lineTotal: Number,
  },
  { _id: false }
);

const statusHistoryEntrySchema = new mongoose.Schema(
  {
    status: String,
    note: String,
    changedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema({
  orderId: {
    type: String,
    unique: true,
    required: true,
  },
  paymentId: String,
  amount: Number,
  amountPaise: Number,
  currency: {
    type: String,
    default: "INR",
  },
  paymentStatus: {
    type: String,
    enum: ["pending", "authorized", "paid", "failed", "refunded"],
    default: "pending",
  },
  orderStatus: {
    type: String,
    enum: [
      "payment_pending",
      "payment_failed",
      "placed",
      "processing",
      "shipped",
      "delivered",
      "cancelled",
      "needs_review",
    ],
    default: "payment_pending",
  },
  statusHistory: [statusHistoryEntrySchema],
  user: {
    name: String,
    phone: String,
    email: String,
    age: String,
    sex: String,
    place: String,
    address: String,
    city: String,
    state: String,
    pincode: String,
  },
  customer: {
    name: String,
    phone: String,
    email: String,
    address: String,
  },
  items: [orderItemSchema],
  total: Number,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Order", orderSchema);
