// routes/unsubscribeList.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

// Use contact DB connection
const contactConn = mongoose.createConnection(process.env.MONGO_URI_CONTACT, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Schema
const unsubscribeSchema = new mongoose.Schema(
  {
    FirstName: String,
    LastName: String,
    Email: String,
    ContactNo: String,
    JobTitle: String,
    CompanyName: String,
    CampaignName: String,
    LinkedIn: String,
    UnsubscribeOn: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const UnsubscribeList = contactConn.model(
  "unsubscribelist",
  unsubscribeSchema,
  "unsubscribelist"
);

// 📌 Get all unsubscribed contacts
router.get("/list", async (req, res) => {
  try {
    const list = await UnsubscribeList.find().sort({ UnsubscribeOn: -1 });
    res.json(list);
  } catch (err) {
    console.error("Error fetching unsubscribe list:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// 📌 Add manually to unsubscribe list
router.post("/upload", async (req, res) => {
  try {
    const contact = await UnsubscribeList.create(req.body);
    res.json(contact);
  } catch (err) {
    console.error("Error uploading unsubscribe:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// 📌 Remove from unsubscribe list
router.delete("/remove/:id", async (req, res) => {
  try {
    await UnsubscribeList.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error("Error removing unsubscribe:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
