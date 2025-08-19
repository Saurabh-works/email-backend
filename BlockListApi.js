const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

// Schema & Model
const blockListSchema = new mongoose.Schema({
  FirstName: String,
  LastName: String,
  Email: String,
  ContactNo: String,
  JobTitle: String,
  CompanyName: String,
  LinkedinLink: String,
  createdAt: { type: Date, default: Date.now }
});

const BlockList = mongoose.model("BlockList", blockListSchema, "BlockList");

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
