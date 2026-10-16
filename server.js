require("dotenv").config();

const express = require("express");
const cors = require("cors");
const session = require("express-session");
const MongoStore = require("connect-mongo").default;
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Product = require("./models/Product");
const Category = require("./models/Category");
const Admin = require("./models/Admin");
const adminAuthRouter = require("./routes/adminAuth");
const adminOverviewRouter = require("./routes/adminOverview");
const adminProductsRouter = require("./routes/adminProducts");
const adminCategoriesRouter = require("./routes/adminCategories");
const adminOrdersRouter = require("./routes/adminOrders");
const adminCustomersRouter = require("./routes/adminCustomers");
const paymentRouter = require("./routes/payments");

const app = express();

/* ================= CORS ================= */

const frontendOrigins = (
  process.env.FRONTEND_ORIGINS ||
  "http://localhost:3000,http://localhost:3001,https://acteast.co.in,https://www.acteast.co.in"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || frontendOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Origin is not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use("/api", paymentRouter);
app.use(express.json());

const adminSessionSecret = process.env.ADMIN_SESSION_SECRET || "";

if (
  Buffer.byteLength(adminSessionSecret, "utf8") >= 32 &&
  process.env.MONGO_URI
) {
  const isProduction = process.env.NODE_ENV === "production";

  app.set("trust proxy", 1);
  app.use(
    session({
      name: "acteast.admin.sid",
      secret: adminSessionSecret,
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({
        mongoUrl: process.env.MONGO_URI,
        collectionName: "admin_sessions",
        ttl: 8 * 60 * 60,
      }),
      cookie: {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
        maxAge: 8 * 60 * 60 * 1000,
        path: "/",
      },
    })
  );
} else {
  console.warn("Admin sessions are disabled: set a random ADMIN_SESSION_SECRET of at least 32 bytes in backend/.env");
}

app.use("/api/admin/auth", adminAuthRouter);
app.use("/api/admin/overview", adminOverviewRouter);
app.use("/api/admin/products", adminProductsRouter);
app.use("/api/admin/categories", adminCategoriesRouter);
app.use("/api/admin/orders", adminOrdersRouter);
app.use("/api/admin/customers", adminCustomersRouter);

/* ================= HOME ROUTE ================= */

app.get("/", (req, res) => {
  res.send("API Running ✅");
});

/* ================= TEST ROUTE ================= */

app.get("/api/test", (req, res) => {
  res.send("Backend Working ✅");
});

/* ================= PRODUCTS ================= */

app.get("/api/products", async (req, res) => {
  try {
    const filter = { isActive: true };

    if (typeof req.query.category === "string" && req.query.category.trim()) {
      filter.category = req.query.category.trim().toLowerCase();
    }

    const products = await Product.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      count: products.length,
      products,
    });
  } catch (err) {
    console.error("GET PRODUCTS ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Could not fetch products",
    });
  }
});

app.get("/api/products/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid product id" });
    }

    const product = await Product.findOne({
      _id: req.params.id,
      isActive: true,
    }).lean();

    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    res.status(200).json({ success: true, product });
  } catch (err) {
    console.error("GET PRODUCT DETAILS ERROR:", err);
    res.status(500).json({ success: false, message: "Could not fetch product details" });
  }
});

app.get("/api/categories", async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true })
      .sort({ sortOrder: 1, name: 1 })
      .lean();

    res.status(200).json({
      success: true,
      count: categories.length,
      categories,
    });
  } catch (err) {
    console.error("GET CATEGORIES ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Could not fetch categories",
    });
  }
});

/* ================= MONGODB ================= */

mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("MongoDB Connected ✅");

    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;

    if (!email && !password) {
      console.warn("No initial admin configured; set ADMIN_EMAIL and ADMIN_PASSWORD");
      return;
    }

    if (
      !email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !password ||
      password.length < 12 ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      console.error("Initial admin configuration is invalid; check ADMIN_EMAIL and ADMIN_PASSWORD");
      return;
    }

    try {
      const passwordHash = await bcrypt.hash(password, 12);
      const result = await Admin.updateOne(
        { email },
        {
          $set: { role: "owner" },
          $setOnInsert: { email, passwordHash, isActive: true },
        },
        { upsert: true }
      );

      if (result.upsertedCount > 0) {
        console.log("Initial owner account created ✅");
      } else {
        console.log("Initial owner account already exists ✅");
      }
    } catch (error) {
      if (error.code === 11000) {
        console.log("Initial owner account already exists ✅");
        return;
      }
      throw error;
    }
  })
  .catch((err) => {
    console.log("MongoDB Error ❌", err);
  });

/* ================= GLOBAL ERROR ================= */

process.on(
  "uncaughtException",
  (err) => {
    console.log(
      "UNCAUGHT ERROR ❌",
      err
    );
  }
);

/* ================= START SERVER ================= */

const PORT =
  process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(
    `Server running on ${PORT} ✅`
  );
});


// require("dotenv").config();

// const express = require("express");
// const cors = require("cors");
// const mongoose = require("mongoose");
// const Razorpay = require("razorpay");
// const crypto = require("crypto");

// const app = express();

// /* ================= CORS ================= */

// app.use(cors({
//   origin: [
//     "http://localhost:3000",
//     "https://acteast.co.in",
//     "https://www.acteast.co.in",
//     "https://api.acteast.co.in"
//   ],

//   methods: [
//     "GET",
//     "POST",
//     "PUT",
//     "DELETE",
//     "OPTIONS"
//   ],

//   allowedHeaders: [
//     "Content-Type",
//     "Authorization"
//   ]
// }));

// app.use(express.json());

// /* ================= ROUTES ================= */

// // Home Route
// app.get("/", (req, res) => {
//   res.send("API running ✅");
// });

// // Test Route
// app.get("/api/test", (req, res) => {
//   res.send("Test route working ✅");
// });

// // GET Create Order Test
// app.get("/api/create-order", (req, res) => {
//   res.send("Create Order Route Working ✅");
// });

// /* ================= MONGO CONNECT ================= */

// mongoose.connect(process.env.MONGO_URI)

//   .then(() => {
//     console.log("MongoDB Connected ✅");
//   })

//   .catch((err) => {
//     console.log("Mongo Error ❌", err);
//   });

// /* ================= ORDER MODEL ================= */

// const orderSchema = new mongoose.Schema({

//   orderId: String,

//   paymentId: String,

//   amount: Number,

//   createdAt: {
//     type: Date,
//     default: Date.now
//   }

// });

// const Order = mongoose.model(
//   "Order",
//   orderSchema
// );

// /* ================= RAZORPAY ================= */

// const razorpay = new Razorpay({

//   key_id: process.env.KEY_ID,

//   key_secret: process.env.KEY_SECRET,

// });

// /* ================= CREATE ORDER ================= */

// app.post("/api/create-order", async (req, res) => {

//   try {

//     const { amount } = req.body;

//     if (!amount) {

//       return res.status(400).json({
//         success: false,
//         message: "Amount is required ❌"
//       });
//     }

//     const options = {

//       amount: amount * 100,

//       currency: "INR",

//       receipt:
//         "receipt_" + Date.now(),
//     };

//     const order =
//       await razorpay.orders.create(options);

//     console.log("ORDER CREATED ✅", order);

//     res.status(200).json({

//       success: true,

//       order

//     });

//   } catch (err) {

//     console.log(
//       "CREATE ORDER ERROR ❌",
//       err
//     );

//     res.status(500).json({

//       success: false,

//       message: "Order creation failed ❌"

//     });
//   }
// });

// /* ================= VERIFY PAYMENT ================= */

// app.post("/api/verify-payment", async (req, res) => {

//   try {

//     const {

//       razorpay_order_id,

//       razorpay_payment_id,

//       razorpay_signature,

//       amount

//     } = req.body;

//     const body =
//       razorpay_order_id +
//       "|" +
//       razorpay_payment_id;

//     const expectedSignature =
//       crypto

//         .createHmac(
//           "sha256",
//           process.env.KEY_SECRET
//         )

//         .update(body.toString())

//         .digest("hex");

//     /* ================= SIGNATURE MATCH ================= */

//     if (
//       expectedSignature ===
//       razorpay_signature
//     ) {

//       const order = new Order({

//         orderId:
//           razorpay_order_id,

//         paymentId:
//           razorpay_payment_id,

//         amount: amount,

//         createdAtIST:
//           new Date().toLocaleString(
//             "en-IN",
//             {
//               timeZone:
//                 "Asia/Kolkata",
//             }
//           ),
//       });

//       await order.save();

//       console.log(
//         "PAYMENT VERIFIED ✅"
//       );

//       return res.status(200).json({

//         success: true,

//         message:
//           "Payment verified ✅",

//         order

//       });
//     }

//     /* ================= INVALID SIGNATURE ================= */

//     return res.status(400).json({

//       success: false,

//       message:
//         "Invalid Signature ❌"

//     });

//   } catch (err) {

//     console.log(
//       "VERIFY PAYMENT ERROR ❌",
//       err
//     );

//     res.status(500).json({

//       success: false,

//       message:
//         "Payment verification failed ❌"

//     });
//   }
// });

// /* ================= SAVE ORDER ================= */

// app.post("/api/save-order", async (req, res) => {

//   try {

//     const {

//       user,

//       items,

//       paymentId,

//       orderId

//     } = req.body;

//     console.log("ORDER SAVED ✅");

//     console.log(req.body);

//     res.status(200).json({

//       success: true,

//       message:
//         "Order saved successfully ✅"

//     });

//   } catch (err) {

//     console.log(
//       "SAVE ORDER ERROR ❌",
//       err
//     );

//     res.status(500).json({

//       success: false,

//       message:
//         "Error saving order ❌"

//     });
//   }
// });

// /* ================= GLOBAL ERROR ================= */

// process.on(
//   "uncaughtException",
//   (err) => {

//     console.log(
//       "UNCAUGHT ERROR ❌",
//       err
//     );
//   }
// );

// /* ================= START SERVER ================= */

// const PORT =
//   process.env.PORT || 5000;

// app.listen(PORT, () => {

//   console.log(
//     `Server running on ${PORT} ✅`
//   );
// });

// require("dotenv").config();

// const express = require("express");
// const cors = require("cors");
// const mongoose = require("mongoose");
// const Razorpay = require("razorpay");
// const crypto = require("crypto");

// // const app = express();
// // app.use(cors());
// // app.use(express.json());

// const app = express();
// app.use(cors({
//   origin: [
//     "http://localhost:3000",
//     "https://acteast.co.in"
//   ],
//   methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
//   allowedHeaders: ["Content-Type", "Authorization"]
// }));
// app.use(express.json());
// /* =================Route section================= */
// app.get("/", (req, res) => {
//   res.send("API running ✅");
// });

// app.get("/api/test", (req, res) => {
//   res.send("Test route working ✅");
// });

// // app.get("/*", (req, res) => {
// //   res.send(`Route hit: ${req.originalUrl}`);
// // });

// /* ================= MONGO ================= */
// mongoose.connect(process.env.MONGO_URI)
//   .then(() => console.log("MongoDB Connected"))
//   .catch((err) => console.log(err));

// /* ================= ORDER MODEL ================= */
// const orderSchema = new mongoose.Schema({
//   orderId: String,
//   paymentId: String,
//   amount: Number,
//   createdAt: { type: Date, default: Date.now }
// });

// const Order = mongoose.model("Order", orderSchema);

// /* ================= RAZORPAY ================= */
// const razorpay = new Razorpay({
//   key_id: process.env.KEY_ID,
//   key_secret: process.env.KEY_SECRET,
// });

// /* ================= CREATE ORDER ================= */
// app.post("/api/create-order", async (req, res) => {
//   try {
//     const { amount } = req.body;

//     const order = await razorpay.orders.create({
//       amount: amount * 100,
//       currency: "INR",
//       receipt: "receipt_" + Date.now(),
//     });

//     res.json(order);
//   } catch (err) {
//     console.log(err);
//     res.status(500).json({ error: "Order creation failed" });
//   }
// });

// /* ================= VERIFY PAYMENT ================= */
// app.post("/api/verify-payment", async (req, res) => {
//   try {
//     const {
//       razorpay_order_id,
//       razorpay_payment_id,
//       razorpay_signature,
//       amount
//     } = req.body;

//     const body = razorpay_order_id + "|" + razorpay_payment_id;

//     const expectedSignature = crypto
//       .createHmac("sha256", process.env.KEY_SECRET)
//       .update(body)
//       .digest("hex");

//     if (expectedSignature === razorpay_signature) {
//       const order = new Order({
//         orderId: razorpay_order_id,
//         paymentId: razorpay_payment_id,
//         amount: amount,
//             // 🟢 India Time (IST)
//         createdAtIST: new Date().toLocaleString("en-IN", {
//           timeZone: "Asia/Kolkata",
//         }),
//       });

//       await order.save();

//       return res.json({ success: true, order });
//     }

//     return res.json({ success: false });

//   } catch (err) {
//     console.log(err);
//     res.status(500).json({ success: false });
//   }
// });

// /* ================= save-order ================= */
// app.post("/api/save-order", async (req, res) => {
//   try {
//     const { user, items, paymentId, orderId } = req.body;

//     console.log("ORDER SAVED:", req.body);

//     // 👉 For now just send success
//     // later you can save in DB
//     res.json({
//       success: true,
//       message: "Order saved successfully",
//     });

//   } catch (error) {
//     console.log(error);
//     res.status(500).json({
//       success: false,
//       message: "Error saving order",
//     });
//   }
// });
// /* ================= START SERVER ================= */

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   console.log("Server running on", PORT);
// });