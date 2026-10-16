const express = require("express");
const mongoose = require("mongoose");
const Order = require("../models/Order");
const { requireAdmin, requireRole } = require("../middleware/requireAdmin");

const router = express.Router();

router.use(requireAdmin, requireRole("owner", "orders"));

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

router.get("/", async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const filter = {};

    if (typeof req.query.paymentStatus === "string" && req.query.paymentStatus.trim()) {
      filter.paymentStatus = req.query.paymentStatus.trim();
    }
    if (typeof req.query.orderStatus === "string" && req.query.orderStatus.trim()) {
      filter.orderStatus = req.query.orderStatus.trim();
    }
    if (typeof req.query.search === "string" && req.query.search.trim()) {
      const safeSearch = escapeRegex(req.query.search.trim().slice(0, 80));
      filter.$or = [
        { orderId: { $regex: safeSearch, $options: "i" } },
        { paymentId: { $regex: safeSearch, $options: "i" } },
        { "user.name": { $regex: safeSearch, $options: "i" } },
        { "user.email": { $regex: safeSearch, $options: "i" } },
        { "user.phone": { $regex: safeSearch, $options: "i" } },
      ];
    }

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      orders,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/status", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid order id" });
    }

    const nextStatus = typeof req.body.status === "string" ? req.body.status.trim() : "";
    const allowedStatuses = ["processing", "shipped", "delivered"];
    if (!allowedStatuses.includes(nextStatus)) {
      return res.status(400).json({ success: false, message: "Choose a valid order status" });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (order.paymentStatus !== "paid") {
      return res.status(409).json({ success: false, message: "Only paid orders can move through fulfillment" });
    }

    const allowedTransitions = {
      placed: ["processing"],
      processing: ["shipped"],
      shipped: ["delivered"],
      needs_review: ["processing"],
    };
    if (!allowedTransitions[order.orderStatus]?.includes(nextStatus)) {
      return res.status(409).json({
        success: false,
        message: `Order cannot move from ${order.orderStatus} to ${nextStatus}`,
      });
    }

    order.orderStatus = nextStatus;
    order.statusHistory.push({ status: nextStatus, note: "Updated by admin" });
    await order.save();

    res.status(200).json({ success: true, order });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
