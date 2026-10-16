const Admin = require("../models/Admin");

const requireAdmin = async (req, res, next) => {
  try {
    if (!req.session?.adminId) {
      return res.status(401).json({
        success: false,
        message: "Please log in",
      });
    }

    const admin = await Admin.findOne({
      _id: req.session.adminId,
      isActive: true,
    }).select("email role");

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Please log in",
      });
    }

    req.admin = admin;
    next();
  } catch (error) {
    next(error);
  }
};

const requireRole = (...allowedRoles) => (req, res, next) => {
  if (!req.admin || !allowedRoles.includes(req.admin.role)) {
    return res.status(403).json({
      success: false,
      message: "You do not have permission to manage products",
    });
  }

  next();
};

module.exports = { requireAdmin, requireRole };
