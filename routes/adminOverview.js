const express = require("express");
const Product = require("../models/Product");
const Category = require("../models/Category");
const Order = require("../models/Order");
const { requireAdmin } = require("../middleware/requireAdmin");

const router = express.Router();
router.use(requireAdmin);

router.get("/", async (req, res, next) => {
  try {
    const canManageCatalog = ["owner", "catalog"].includes(req.admin.role);
    const canManageOrders = ["owner", "orders"].includes(req.admin.role);
    const overview = {
      products: null,
      categories: null,
      orders: null,
      customers: null,
      recentOrders: [],
    };

    if (canManageCatalog) {
      const [products, categories] = await Promise.all([
        Product.countDocuments(),
        Category.countDocuments(),
      ]);
      overview.products = products;
      overview.categories = categories;
    }

    if (canManageOrders) {
      const [orders, customerGroups, recentOrders] = await Promise.all([
        Order.countDocuments(),
        Order.aggregate([
          { $match: { paymentStatus: "paid" } },
          {
            $project: {
              customerKey: {
                $cond: [
                  { $ne: [{ $ifNull: ["$user.phone", ""] }, ""] },
                  { $concat: ["phone:", "$user.phone"] },
                  { $concat: ["email:", { $toLower: { $ifNull: ["$user.email", ""] } }] },
                ],
              },
            },
          },
          { $match: { customerKey: { $ne: "email:" } } },
          { $group: { _id: "$customerKey" } },
          { $count: "total" },
        ]),
        Order.find()
          .sort({ createdAt: -1 })
          .limit(5)
          .select("orderId amount currency paymentId paymentStatus orderStatus user.name user.phone items.name items.weight items.quantity createdAt")
          .lean(),
      ]);

      overview.orders = orders;
      overview.customers = customerGroups[0]?.total || 0;
      overview.recentOrders = recentOrders;
    }

    res.status(200).json({ success: true, overview });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
