const mongoose = require("mongoose");

const productVariantSchema = new mongoose.Schema({
  label: {
    type: String,
    required: true,
    trim: true,
  },
  image: {
    type: String,
    trim: true,
    default: "",
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  stock: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },
});

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    image: {
      type: String,
      required: true,
      trim: true,
    },
    galleryImages: {
      type: [
        {
          type: String,
          trim: true,
        },
      ],
      default: [],
      validate: {
        validator: (images) => images.length <= 8,
        message: "A product can have up to 8 additional gallery images",
      },
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    variants: {
      type: [productVariantSchema],
      validate: {
        validator: (variants) => variants.length > 0,
        message: "A product must have at least one variant",
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Product", productSchema);
