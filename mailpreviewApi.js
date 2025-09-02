// backend/routes/mailpreviewApi.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");


// Use a separate MongoDB connection for preview
const previewConnection = mongoose.createConnection(
  process.env.PREVIEW_DB_URI,
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  }
);

// Schema
const emailTemplateSchema = new mongoose.Schema({
  name: String,
  html: String,
  css: String,
  createdAt: { type: Date, default: Date.now },
});

// Model from preview connection
const EmailTemplate = previewConnection.model(
  "EmailTemplate",
  emailTemplateSchema
);

// Routes

// 🔍 SEARCH by name
router.get("/search", async (req, res) => {
  try {
    const { q } = req.query;

    let query = {};
    if (q) {
      query = { name: { $regex: q, $options: "i" } }; // case-insensitive search
    }

    const templates = await EmailTemplate.find(query).sort({ createdAt: -1 });
    res.json(templates);
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Failed to search templates" });
  }
});

// GET all
router.get("/", async (req, res) => {
  const templates = await EmailTemplate.find().sort({ createdAt: -1 });
  res.json(templates);
});

// GET one
// router.get("/", async (req, res) => {
//   try {
//     const templates = await EmailTemplate.find().sort({ createdAt: -1 });
//     res.json(templates); // must be an array
//   } catch (err) {
//     console.error("Fetch error:", err);
//     res.status(500).json({ error: "Failed to fetch templates" });
//   }
// });

// CREATE
router.post("/", async (req, res) => {
  const { name, html, css } = req.body;
  const newTemplate = new EmailTemplate({ name, html, css });
  await newTemplate.save();
  res.json(newTemplate);
});

// UPDATE
router.put("/:id", async (req, res) => {
  const { html, css } = req.body;
  const updated = await EmailTemplate.findByIdAndUpdate(
    req.params.id,
    { html, css },
    { new: true }
  );
  res.json(updated);
});

// DUPLICATE
router.post("/:id/duplicate", async (req, res) => {
  try {
    const original = await EmailTemplate.findById(req.params.id);
    const { name } = req.body;

    const duplicated = new EmailTemplate({
      name: name || `${original.name}-copy`,
      html: original.html,
      css: original.css,
    });

    await duplicated.save();
    res.json(duplicated);
  } catch (err) {
    console.error("Error duplicating template:", err);
    res.status(500).send("Server error");
  }
});

// DELETE a template
router.delete("/:id", async (req, res) => {
  try {
    await EmailTemplate.findByIdAndDelete(req.params.id);
    res.json({ message: "Template deleted" });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ error: "Failed to delete template" });
  }
});




// RENAME a template
router.patch("/:id/rename", async (req, res) => {
  try {
    console.log("Rename request:", req.params.id, req.body);
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });

    const updated = await EmailTemplate.findByIdAndUpdate(
      req.params.id,
      { name },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ error: "Template not found" });
    }

    res.json(updated);
  } catch (err) {
    console.error("Rename error:", err);
    res.status(500).json({ error: "Failed to rename template" });
  }
});


module.exports = router;
