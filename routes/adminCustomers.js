const express = require("express");
const Order = require("../models/Order");
const { requireAdmin, requireRole } = require("../middleware/requireAdmin");

const router = express.Router();
router.use(requireAdmin, requireRole("owner", "orders"));

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

router.get("/", async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const pipeline = [
      { $match: { paymentStatus: "paid" } },
      { $sort: { createdAt: -1 } },
      {
        $addFields: {
          customerName: { $ifNull: ["$user.name", { $ifNull: ["$customer.name", "Customer"] }] },
          customerPhone: { $ifNull: ["$user.phone", { $ifNull: ["$customer.phone", ""] }] },
          customerEmail: { $ifNull: ["$user.email", { $ifNull: ["$customer.email", ""] }] },
          customerAddress: { $ifNull: ["$user.address", { $ifNull: ["$customer.address", ""] }] },
          customerCity: { $ifNull: ["$user.city", "$user.place"] },
          customerState: "$user.state",
          customerPincode: "$user.pincode",
        },
      },
      {
        $addFields: {
          customerKey: {
            $cond: [
              { $ne: ["$customerPhone", ""] },
              { $concat: ["phone:", "$customerPhone"] },
              { $concat: ["email:", { $toLower: "$customerEmail" }] },
            ],
          },
        },
      },
      { $match: { customerKey: { $nin: ["phone:", "email:"] } } },
      {
        $group: {
          _id: "$customerKey",
          name: { $first: "$customerName" },
          phone: { $first: "$customerPhone" },
          email: { $first: "$customerEmail" },
          address: { $first: "$customerAddress" },
          city: { $first: "$customerCity" },
          state: { $first: "$customerState" },
          pincode: { $first: "$customerPincode" },
          latestOrderId: { $first: "$orderId" },
          lastOrderAt: { $max: "$createdAt" },
          orderCount: { $sum: 1 },
          totalSpent: { $sum: { $ifNull: ["$amount", 0] } },
        },
      },
    ];

    if (typeof req.query.search === "string" && req.query.search.trim()) {
      const safeSearch = new RegExp(escapeRegex(req.query.search.trim().slice(0, 80)), "i");
      pipeline.push({
        $match: {
          $or: [
            { name: safeSearch },
            { phone: safeSearch },
            { email: safeSearch },
            { city: safeSearch },
          ],
        },
      });
    }

    pipeline.push({
      $facet: {
        customers: [
          { $sort: { lastOrderAt: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
        ],
        total: [{ $count: "count" }],
      },
    });

    const [result] = await Order.aggregate(pipeline);
    const total = result?.total?.[0]?.count || 0;
    res.status(200).json({
      success: true,
      customers: result?.customers || [],
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;