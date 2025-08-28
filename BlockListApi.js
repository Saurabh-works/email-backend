const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

// Connect to your specific "contact" database
const MONGO_URI = process.env.MONGO_URI_CONTACT;

const conn = mongoose.createConnection(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Schema & Model using the dedicated connection
const blockListSchema = new mongoose.Schema({
  FirstName: String,
  LastName: String,
  Email: String,
  ContactNo: String,
  JobTitle: String,
  CompanyName: String,
  CampaignId: String,
  LinkedinLink: String,
  createdAt: { type: Date, default: Date.now },
});

// Use conn.model instead of mongoose.model to ensure it's in "contact" DB
const BlockList = conn.model("BlockList", blockListSchema, "BlockList");

// Add new blocked contact
router.post("/upload", async (req, res) => {
  try {
    const contact = new BlockList(req.body);
    await contact.save();
    res.status(201).json(contact);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get all blocked contacts (latest first)
router.get("/list", async (req, res) => {
  try {
    const contacts = await BlockList.find().sort({ createdAt: -1 });
    res.json(contacts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search blocked contact(s) by email (case-insensitive, indexed, latest 5 only)
router.get("/search", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: "Email query required" });
    }

    const contacts = await BlockList.find({
      Email: { $regex: `^${email}`, $options: "i" }, // starts with
    })
      .sort({ createdAt: -1 })
      .limit(5);

    res.json(contacts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




// Delete blocked contact by ID
router.delete("/remove/:id", async (req, res) => {
  try {
    await BlockList.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
