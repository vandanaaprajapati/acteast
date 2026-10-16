const express = require("express");
const mongoose = require("mongoose");
const Category = require("../models/Category");
const Product = require("../models/Product");
const { requireAdmin, requireRole } = require("../middleware/requireAdmin");

const router = express.Router();

router.use(requireAdmin, requireRole("owner", "catalog"));

const makeSlug = (name) => name
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");

const validateCategory = (body, { creating = false } = {}) => {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const sortOrder = body.sortOrder === undefined ? 0 : body.sortOrder;

  if (name.length < 2 || name.length > 60) {
    return { error: "Category name must be between 2 and 60 characters" };
  }
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000) {
    return { error: "Display order must be a whole number from 0 to 10000" };
  }

  const value = { name, sortOrder };
  if (creating) {
    const slug = makeSlug(name);
    if (!slug || slug.length > 80) {
      return { error: "Category name cannot be converted to a valid slug" };
    }
    value.slug = slug;
    value.isActive = true;
  }

  return { value };
};

router.get("/", async (req, res, next) => {
  try {
    const categories = await Category.find()
      .sort({ sortOrder: 1, name: 1 })
      .lean();
    res.status(200).json({ success: true, count: categories.length, categories });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const validation = validateCategory(req.body || {}, { creating: true });
    if (validation.error) {
      return res.status(400).json({ success: false, message: validation.error });
    }

    const category = await Category.create(validation.value);
    res.status(201).json({ success: true, category });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "A category with this name already exists" });
    }
    next(error);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid category id" });
    }

    const validation = validateCategory(req.body || {});
    if (validation.error) {
      return res.status(400).json({ success: false, message: validation.error });
    }

    const category = await Category.findByIdAndUpdate(
      req.params.id,
      { $set: validation.value },
      { new: true, runValidators: true }
    );
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    res.status(200).json({ success: true, category });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/archive", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid category id" });
    }

    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    const activeProductExists = await Product.exists({
      category: category.slug,
      isActive: true,
    });
    if (activeProductExists) {
      return res.status(409).json({
        success: false,
        message: "Deactivate or move this category's active products before deactivating it",
      });
    }

    category.isActive = false;
    await category.save();
    res.status(200).json({ success: true, message: "Category archived", category });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/reactivate", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid category id" });
    }

    const category = await Category.findByIdAndUpdate(
      req.params.id,
      { $set: { isActive: true } },
      { new: true, runValidators: true }
    );
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    res.status(200).json({ success: true, message: "Category reactivated", category });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
