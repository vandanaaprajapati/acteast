const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");
const Razorpay = require("razorpay");
const Order = require("../models/Order");
const Product = require("../models/Product");

const router = express.Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const getRazorpayClient = () => {
  if (!process.env.KEY_ID || !process.env.KEY_SECRET) {
    return null;
  }
  return new Razorpay({
    key_id: process.env.KEY_ID,
    key_secret: process.env.KEY_SECRET,
  });
};

const normalizeCustomer = (input) => {
  const user = {
    name: typeof input?.name === "string" ? input.name.trim() : "",
    phone: typeof input?.phone === "string" ? input.phone.trim() : "",
    email: typeof input?.email === "string" ? input.email.trim().toLowerCase() : "",
    address: typeof input?.address === "string" ? input.address.trim() : "",
    city: typeof input?.city === "string" ? input.city.trim() : "",
    state: typeof input?.state === "string" ? input.state.trim() : "",
    pincode: typeof input?.pincode === "string" ? input.pincode.trim() : "",
  };

  if (user.name.length < 2 || user.name.length > 120) {
    return { error: "Enter a valid full name" };
  }
  if (!/^[6-9]\d{9}$/.test(user.phone)) {
    return { error: "Enter a valid 10-digit Indian phone number" };
  }
  if (user.email && !emailPattern.test(user.email)) {
    return { error: "Enter a valid email address" };
  }
  if (!user.address || user.address.length > 500) {
    return { error: "Enter a delivery address of up to 500 characters" };
  }
  if (user.city.length < 2 || user.city.length > 80) {
    return { error: "Enter a valid city" };
  }
  if (user.state.length < 2 || user.state.length > 80) {
    return { error: "Enter a valid state" };
  }
  if (!/^\d{6}$/.test(user.pincode)) {
    return { error: "Enter a valid 6-digit PIN code" };
  }

  return { value: user };
};

const calculateVerifiedItems = async (requestedItems) => {
  if (!Array.isArray(requestedItems) || requestedItems.length === 0 || requestedItems.length > 30) {
    return { error: "Cart must contain between 1 and 30 items" };
  }

  const normalizedItems = [];
  const seenVariants = new Set();
  for (const item of requestedItems) {
    const productId = typeof item?.productId === "string" ? item.productId : "";
    const variantId = typeof item?.variantId === "string" ? item.variantId : "";
    const quantity = Number(item?.quantity);

    if (!mongoose.isValidObjectId(productId) || !mongoose.isValidObjectId(variantId)) {
      return { error: "Cart contains an invalid product or pack size" };
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      return { error: "Each item quantity must be between 1 and 50" };
    }

    const key = `${productId}:${variantId}`;
    if (seenVariants.has(key)) {
      return { error: "Remove duplicate pack sizes from the cart and try again" };
    }
    seenVariants.add(key);
    normalizedItems.push({ productId, variantId, quantity });
  }

  const productIds = [...new Set(normalizedItems.map((item) => item.productId))];
  const products = await Product.find({ _id: { $in: productIds }, isActive: true }).lean();
  const productsById = new Map(products.map((product) => [String(product._id), product]));
  const orderItems = [];
  let amountPaise = 0;

  for (const requested of normalizedItems) {
    const product = productsById.get(requested.productId);
    if (!product) {
      return { error: "A product in your cart is no longer available" };
    }

    const variant = product.variants.find((entry) => String(entry._id) === requested.variantId);
    if (!variant) {
      return { error: `${product.name} pack size is no longer available` };
    }
    if (variant.stock < requested.quantity) {
      return { error: `Only ${variant.stock} of ${product.name} (${variant.label}) are currently available` };
    }

    const unitPricePaise = Math.round(Number(variant.price) * 100);
    if (!Number.isSafeInteger(unitPricePaise) || unitPricePaise < 0) {
      return { error: `Invalid price configured for ${product.name}` };
    }
    const lineTotalPaise = unitPricePaise * requested.quantity;
    amountPaise += lineTotalPaise;

    orderItems.push({
      id: `${product._id}:${variant._id}`,
      productId: String(product._id),
      variantId: String(variant._id),
      name: product.name,
      weight: variant.label,
      image: variant.image || product.image,
      price: unitPricePaise / 100,
      unitPricePaise,
      quantity: requested.quantity,
      lineTotal: lineTotalPaise / 100,
    });
  }

  if (!Number.isSafeInteger(amountPaise) || amountPaise < 100) {
    return { error: "Order total must be at least ₹1" };
  }

  return { value: { orderItems, amountPaise, amount: amountPaise / 100 } };
};

const verifySignature = (orderId, paymentId, signature) => {
  const expected = crypto
    .createHmac("sha256", process.env.KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(signature, "hex");
  return expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
};

const settleCapturedOrder = async (orderId, paymentId) => {
  const session = await mongoose.startSession();
  let settledOrder;

  try {
    await session.withTransaction(async () => {
      const order = await Order.findOne({ orderId }).session(session);
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (order.paymentStatus === "paid") {
        settledOrder = order.toObject();
        return;
      }

      for (const item of order.items) {
        const stockUpdate = await Product.updateOne(
          {
            _id: item.productId,
            isActive: true,
            variants: {
              $elemMatch: {
                _id: item.variantId,
                stock: { $gte: item.quantity },
              },
            },
          },
          { $inc: { "variants.$.stock": -item.quantity } },
          { session }
        );

        if (stockUpdate.modifiedCount !== 1) {
          const stockError = new Error("STOCK_UNAVAILABLE_AFTER_PAYMENT");
          stockError.code = "STOCK_UNAVAILABLE_AFTER_PAYMENT";
          throw stockError;
        }
      }

      order.paymentId = paymentId;
      order.paymentStatus = "paid";
      order.orderStatus = "placed";
      order.statusHistory.push({ status: "placed", note: "Payment captured" });
      await order.save({ session });
      settledOrder = order.toObject();
    });

    return { order: settledOrder, needsReview: settledOrder?.orderStatus === "needs_review" };
  } catch (error) {
    if (error.code === "STOCK_UNAVAILABLE_AFTER_PAYMENT") {
      const order = await Order.findOneAndUpdate(
        { orderId, paymentStatus: { $ne: "paid" } },
        {
          $set: { paymentId, paymentStatus: "paid", orderStatus: "needs_review" },
          $push: { statusHistory: { status: "needs_review", note: "Payment captured; stock requires manual confirmation" } },
        },
        { new: true }
      );
      return { order, needsReview: true };
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

const markPaymentFailed = async (orderId, paymentId, note) => Order.findOneAndUpdate(
  { orderId, paymentStatus: { $in: ["pending", "authorized"] } },
  {
    $set: { paymentId, paymentStatus: "failed", orderStatus: "payment_failed" },
    $push: { statusHistory: { status: "payment_failed", note } },
  },
  { new: true }
);

router.post("/payment-webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.get("x-razorpay-signature");
  if (!webhookSecret || !signature || !Buffer.isBuffer(req.body)) {
    return res.status(400).send("Webhook configuration or signature missing");
  }

  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(req.body)
    .digest("hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const receivedBuffer = Buffer.from(signature, "hex");
  if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return res.status(400).send("Invalid webhook signature");
  }

  try {
    const payload = JSON.parse(req.body.toString("utf8"));
    const payment = payload.payload?.payment?.entity;
    const orderId = payment?.order_id || payload.payload?.order?.entity?.id;

    if (payload.event === "payment.captured" || payload.event === "order.paid") {
      if (!orderId || !payment?.id) return res.status(200).send("ok");
      const order = await Order.findOne({ orderId });
      if (!order) return res.status(200).send("ok");
      if (payment.amount !== order.amountPaise || payment.currency !== order.currency) {
        return res.status(400).send("Payment amount mismatch");
      }
      await settleCapturedOrder(orderId, payment.id);
    } else if (payload.event === "payment.failed" && orderId) {
      await markPaymentFailed(orderId, payment?.id, payment?.error_description || "Payment failed");
    }

    return res.status(200).send("ok");
  } catch (error) {
    console.error("PAYMENT WEBHOOK ERROR:", error.message);
    return res.status(500).send("Webhook processing failed");
  }
});

router.use(express.json());

router.post("/create-order", async (req, res) => {
  try {
    const razorpay = getRazorpayClient();
    if (!razorpay) {
      return res.status(503).json({ success: false, message: "Online payment is not configured" });
    }

    const customerValidation = normalizeCustomer(req.body?.user);
    if (customerValidation.error) {
      return res.status(400).json({ success: false, message: customerValidation.error });
    }
    const cartValidation = await calculateVerifiedItems(req.body?.items);
    if (cartValidation.error) {
      return res.status(400).json({ success: false, message: cartValidation.error });
    }

    const receipt = `acteast_${crypto.randomUUID().replace(/-/g, "")}`;
    const gatewayOrder = await razorpay.orders.create({
      amount: cartValidation.value.amountPaise,
      currency: "INR",
      receipt,
    });

    const order = await Order.create({
      orderId: gatewayOrder.id,
      amount: cartValidation.value.amount,
      amountPaise: cartValidation.value.amountPaise,
      currency: "INR",
      paymentStatus: "pending",
      orderStatus: "payment_pending",
      statusHistory: [{ status: "payment_pending", note: "Razorpay order created" }],
      user: customerValidation.value,
      items: cartValidation.value.orderItems,
    });

    return res.status(201).json({
      success: true,
      keyId: process.env.KEY_ID,
      order: {
        id: gatewayOrder.id,
        amount: gatewayOrder.amount,
        currency: gatewayOrder.currency,
        receipt: gatewayOrder.receipt,
      },
      orderRecordId: order._id,
    });
  } catch (error) {
    console.error("CREATE ORDER ERROR:", error.message);
    return res.status(500).json({ success: false, message: "Could not create your order" });
  }
});

router.post("/verify-payment", async (req, res) => {
  try {
    const razorpay = getRazorpayClient();
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};

    if (!razorpay || !orderId || !paymentId || !signature || !process.env.KEY_SECRET) {
      return res.status(400).json({ success: false, message: "Payment verification data is incomplete" });
    }
    if (!verifySignature(orderId, paymentId, signature)) {
      return res.status(400).json({ success: false, message: "Invalid payment signature" });
    }

    const order = await Order.findOne({ orderId });
    if (!order) {
      return res.status(404).json({ success: false, message: "Pending order not found" });
    }
    if (order.paymentStatus === "paid") {
      return res.status(200).json({ success: true, message: "Payment already verified", order });
    }

    let payment = await razorpay.payments.fetch(paymentId);
    if (
      payment.order_id !== orderId ||
      payment.amount !== order.amountPaise ||
      payment.currency !== order.currency
    ) {
      return res.status(400).json({ success: false, message: "Payment does not match this order" });
    }

    if (payment.status === "authorized") {
      try {
        payment = await razorpay.payments.capture(paymentId, order.amountPaise, order.currency);
      } catch (captureError) {
        await Order.updateOne(
          { orderId, paymentStatus: "pending" },
          { $set: { paymentStatus: "authorized" }, $push: { statusHistory: { status: "authorized", note: "Capture is pending" } } }
        );
        return res.status(202).json({
          success: false,
          pending: true,
          message: "Payment is authorized and awaiting capture. Do not retry; contact support if confirmation is delayed.",
        });
      }
    }

    if (payment.status === "failed") {
      await markPaymentFailed(orderId, paymentId, payment.error_description || "Payment failed");
      return res.status(402).json({ success: false, message: "Payment was not completed" });
    }
    if (payment.status !== "captured") {
      return res.status(202).json({
        success: false,
        pending: true,
        message: "Payment confirmation is still processing. Please do not retry yet.",
      });
    }

    const result = await settleCapturedOrder(orderId, paymentId);
    return res.status(200).json({
      success: true,
      message: result.needsReview ? "Payment received; order requires stock confirmation" : "Payment captured and order placed",
      order: result.order,
    });
  } catch (error) {
    console.error("VERIFY PAYMENT ERROR:", error.message);
    return res.status(500).json({ success: false, message: "Payment verification could not be completed" });
  }
});

module.exports = router;
