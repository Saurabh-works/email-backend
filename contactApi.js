// NEW contact-api.js 
require("dotenv").config();
const express = require("express");
const multer = require("multer");
const xlsx = require("xlsx");
const mongoose = require("mongoose");
const router = express.Router();
const fs = require("fs");

const upload = multer({ dest: "uploads/" });
const MONGO_URI = process.env.MONGO_URI_CONTACT;

// Single connection to fixed "contact" database
const conn = mongoose.createConnection(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Upload and create contact list
router.post("/upload-contact", upload.single("file"), async (req, res) => {
  const { listName } = req.body;
  const filePath = req.file.path;

  try {
    const workbook = xlsx.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet);

    if (!data.length) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: "Excel file is empty" });
    }

    const Contact = conn.model(
      listName,
      new mongoose.Schema({
        FirstName: String,
        LastName: String,
        Email: String,
        ContactNo: String,
        JobTitle: String,
        CompanyName: String,
        LinkdinLink: String,
        createdAt: { type: Date, default: Date.now },
      }),
      listName // prevent Mongoose from pluralizing
    );

    await Contact.insertMany(data);
    fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Failed to upload contacts" });
  }
});

// Get all contact lists
router.get("/lists", async (req, res) => {
  try {
    const collections = await conn.db.listCollections().toArray();
    const results = [];

    for (const col of collections) {
      if (col.name === "BlockList" || col.name === "unsubscribelist") continue;
      const Model = conn.model(col.name, new mongoose.Schema({}, { strict: false }), col.name);
      const count = await Model.countDocuments();
      const createdDoc = await Model.findOne().sort({ createdAt: 1 });

      results.push({
        listName: col.name,
        count,
        createdAt: createdDoc?.createdAt
          ? new Date(createdDoc.createdAt).toLocaleString()
          : "Unknown",
      });
    }

    res.json(results);
  } catch (err) {
    console.error("List fetch error:", err);
    res.status(500).json({ error: "Failed to fetch contact lists" });
  }
});

// View data in a list
router.get("/view-list-data", async (req, res) => {
  const { listName } = req.query;
  try {
    const Model = conn.model(listName, new mongoose.Schema({}, { strict: false }), listName);
    const data = await Model.find().limit(100);
    res.json(data);
  } catch (err) {
    console.error("View list error:", err);
    res.status(500).json({ error: "Failed to fetch list data" });
  }
});

// Delete a list (collection)
router.delete("/delete-list", async (req, res) => {
  const { listName } = req.body;
  try {
    await conn.dropCollection(listName);
    res.json({ success: true });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ error: "Failed to delete list" });
  }
});

module.exports = router;
