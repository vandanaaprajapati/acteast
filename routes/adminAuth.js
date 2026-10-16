const express = require("express");
const bcrypt = require("bcryptjs");
const Admin = require("../models/Admin");
const { requireAdmin } = require("../middleware/requireAdmin");

const router = express.Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/login", async (req, res, next) => {
  try {
    if (!req.session) {
      return res.status(503).json({
        success: false,
        message: "Admin login is not configured on the server",
      });
    }

    const email = typeof req.body.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "";
    const password = typeof req.body.password === "string"
      ? req.body.password
      : "";

    if (!emailPattern.test(email) || !password || password.length > 72) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid email and password",
      });
    }

    const admin = await Admin.findOne({ email }).select("+passwordHash");
    const passwordMatches = admin
      ? await bcrypt.compare(password, admin.passwordHash)
      : false;

    if (!admin || !admin.isActive || !passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Email or password is incorrect",
      });
    }

    req.session.regenerate((error) => {
      if (error) return next(error);

      req.session.adminId = admin.id;
      req.session.save((saveError) => {
        if (saveError) return next(saveError);

        res.status(200).json({
          success: true,
          admin: {
            email: admin.email,
            role: admin.role,
          },
        });
      });
    });
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireAdmin, (req, res) => {
  res.status(200).json({
    success: true,
    admin: {
      email: req.admin.email,
      role: req.admin.role,
    },
  });
});

router.post("/logout", (req, res, next) => {
  if (!req.session) {
    return res.status(200).json({ success: true });
  }

  req.session.destroy((error) => {
    if (error) return next(error);

    res.clearCookie("acteast.admin.sid", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/",
    });
    res.status(200).json({ success: true });
  });
});

module.exports = router;
