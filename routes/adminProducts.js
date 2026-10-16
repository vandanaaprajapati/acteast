const express = require("express");
const mongoose = require("mongoose");
const Category = require("../models/Category");
const Product = require("../models/Product");
const { requireAdmin, requireRole } = require("../middleware/requireAdmin");

const router = express.Router();

router.use(requireAdmin, requireRole("owner", "catalog"));

const validateProduct = async (body) => {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const category = typeof body.category === "string"
    ? body.category.trim().toLowerCase()
    : "";
  const image = typeof body.image === "string" ? body.image.trim() : "";
  const galleryImages = Array.isArray(body.galleryImages)
    ? body.galleryImages.map((url) => typeof url === "string" ? url.trim() : "")
    : [];
  const description = typeof body.description === "string"
    ? body.description.trim()
    : "";
  const variants = body.variants;

  if (name.length < 2 || name.length > 120) {
    return { error: "Product name must be between 2 and 120 characters" };
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category)) {
    return { error: "Choose a valid product category" };
  }

  try {
    const imageUrl = new URL(image);
    if (!["http:", "https:"].includes(imageUrl.protocol)) {
      return { error: "Product image must use an http or https URL" };
    }
  } catch {
    return { error: "Enter a valid product image URL" };
  }

  if (galleryImages.length > 8) {
    return { error: "Add no more than 8 additional gallery images" };
  }

  for (const galleryImage of galleryImages) {
    try {
      const galleryUrl = new URL(galleryImage);
      if (!["http:", "https:"].includes(galleryUrl.protocol)) {
        return { error: "Gallery images must use http or https URLs" };
      }
    } catch {
      return { error: "Enter a valid URL for every gallery image" };
    }
  }

  if (description.length > 2000) {
    return { error: "Description must be 2000 characters or fewer" };
  }

  if (!Array.isArray(variants) || variants.length === 0 || variants.length > 20) {
    return { error: "Add between 1 and 20 product variants" };
  }

  const cleanVariants = [];
  for (const variant of variants) {
    const label = typeof variant?.label === "string" ? variant.label.trim() : "";
    const variantImage = typeof variant?.image === "string" ? variant.image.trim() : "";
    if (!label || label.length > 60) {
      return { error: "Each pack size must have a label of 1 to 60 characters" };
    }
    if (variantImage) {
      try {
        const imageUrl = new URL(variantImage);
        if (!["http:", "https:"].includes(imageUrl.protocol)) {
          return { error: "Each pack image must use an http or https URL" };
        }
      } catch {
        return { error: "Enter a valid pack image URL" };
      }
    }
    if (typeof variant.price !== "number" || !Number.isFinite(variant.price) || variant.price < 0) {
      return { error: "Each variant price must be a valid non-negative number" };
    }
    if (!Number.isInteger(variant.stock) || variant.stock < 0) {
      return { error: "Each variant stock must be a non-negative whole number" };
    }
    cleanVariants.push({ label, image: variantImage, price: variant.price, stock: variant.stock });
  }

  const categoryExists = await Category.exists({ slug: category, isActive: true });
  if (!categoryExists) {
    return { error: "This category does not exist or is inactive" };
  }

  return {
    value: { name, category, image, galleryImages, description, variants: cleanVariants },
  };
};

router.get("/", async (req, res, next) => {
  try {
    const products = await Product.find()
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({ success: true, count: products.length, products });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const validation = await validateProduct(req.body || {});
    if (validation.error) {
      return res.status(400).json({ success: false, message: validation.error });
    }

    const product = await Product.create(validation.value);
    res.status(201).json({ success: true, product });
  } catch (error) {
    next(error);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid product id" });
    }

    const validation = await validateProduct(req.body || {});
    if (validation.error) {
      return res.status(400).json({ success: false, message: validation.error });
    }

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { $set: validation.value },
      { new: true, runValidators: true }
    );

    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    res.status(200).json({ success: true, product });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid product id" });
    }

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { $set: { isActive: false } },
      { new: true }
    );

    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    res.status(200).json({ success: true, message: "Product archived", product });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/reactivate", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid product id" });
    }

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { $set: { isActive: true } },
      { new: true, runValidators: true }
    );

    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    res.status(200).json({ success: true, message: "Product reactivated", product });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
