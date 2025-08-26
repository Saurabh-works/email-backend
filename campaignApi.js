require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cron = require("node-cron");
// const AWS = require('aws-sdk');
// AWS.config.update({ region: process.env.FORCE_SES_REGION || 'us-east-1' });
const requestIp = require("request-ip");
const uaParser = require("ua-parser-js");
const axios = require("axios");
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
// const { validateSMTP } = require("./smtpValidator");
const juice = require("juice");
// const cron = require('node-cron');
const schedule = require("node-schedule");

const router = express.Router();

// DB Connections
const contactConn = mongoose.createConnection(process.env.MONGO_URI_CONTACT);
const campaignConn = mongoose.createConnection(process.env.CAMPAIGN_DB_URI);

const unsubscribeSchema = new mongoose.Schema({
  FirstName: String,
  LastName: String,
  Email: String,
  ContactNo: String,
  JobTitle: String,
  CompanyName: String,
  CampaignName: String,
  LinkedIn: String,
  UnsubscribeOn: { type: Date, default: Date.now }
});
const UnsubscribeList = contactConn.model("unsubscribelist", unsubscribeSchema, "unsubscribelist");


const logSchema = new mongoose.Schema({
  emailId: String,
  recipientId: String,
  type: String,
  count: { type: Number, default: 1 },
  timestamp: Date,
  sendAt: { type: Date },
  ip: String,
  city: String,
  region: String,
  country: String,
  device: String,
  browser: String,
  os: String,
  // bounceStatus: { type: Boolean, default: false },
  bounceStatus: { type: String, enum: ["NA", "Yes", "No"], default: "NA" },
});
logSchema.index({ emailId: 1, recipientId: 1, type: 1 }, { unique: true });
const Log = campaignConn.model("Log", logSchema);

const sesClient = new SESClient({
  // region: process.env.AWS_REGION,
  region: process.env.FORCE_SES_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

function getRealIp(req) {
  const xfwd = req.headers["x-forwarded-for"];
  if (xfwd) return xfwd.split(",")[0].trim();
  return (
    req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || ""
  );
}

const isBot = (ua) => /bot|crawler|preview|headless/i.test(ua);

async function logEvent(req, type) {
  const ip = getRealIp(req);
  const ua = req.headers["user-agent"] || "";
  const { emailId, recipientId } = req.query;
  if (!emailId || !recipientId) return;

  // Allow unsubscribe without UA detection
  if (type !== "unsubscribe" && isBot(ua)) return;

  // ✅ Add this block here
  if (type === "open") {
    // Check if open happens too soon after "sent"
    // const sentRow = await Log.findOne({ emailId, recipientId, type: "sent" });
    const sentRow = await Log.findOne(
      { emailId, recipientId, type: "sent" },
      {},
      { sort: { timestamp: -1 } } // ✅ ensures most recent send
    );

    if (sentRow && Date.now() - new Date(sentRow.timestamp).getTime() < 5000) {
      console.log(
        `⚠️ Ignoring bot-like open for ${recipientId} (too soon after delivery)`
      );
      return;
    }

    // Optional: ignore known Microsoft/Google spam filter IP ranges
    if (
      ip.startsWith("40.92.") || // Outlook
      ip.startsWith("40.93.") ||
      ip.startsWith("40.94.") ||
      ip.startsWith("40.95.")
    ) {
      console.log(`⚠️ Ignoring open from suspected scanner IP ${ip}`);
      return;
    }
  }

  // Prevent duplicate click logs in short window (existing behavior)
  if (type === "click") {
    const recentClick = await Log.findOne({
      emailId,
      recipientId,
      type,
      timestamp: { $gte: new Date(Date.now() - 5000) },
    });
    if (recentClick) return;
  }

  const { device, browser, os } = uaParser(ua);
  let geo = {};
  try {
    geo = (
      await axios.get(
        `https://ipinfo.io/${getRealIp(req)}?token=${process.env.IPINFO_TOKEN}`
      )
    ).data;
  } catch (e) {
    geo = {};
  }

  const updateData = {
    $inc: { count: 1 },
    $set: {
      timestamp: new Date(),
      ip,
      city: geo.city || "",
      region: geo.region || "",
      country: geo.country || "",
      device: device?.type || "desktop",
      browser: browser?.name || "",
      os: os?.name || "",
    },
  };

  // Prevent accidental bounceStatus overwrite on open/click/unsubscribe
  if (type !== "sent") {
    delete updateData.$set.bounceStatus;
  }

  // ✅ Only when type === "sent", add a permanent sendAt
  if (type === "sent") {
    updateData.$setOnInsert = { sendAt: new Date() };
  }

  // If this is an 'open' event, check whether an open already exists (so we can detect "first open")
  let wasOpenBefore = false;
  if (type === "open") {
    const existingOpen = await Log.findOne({
      emailId,
      recipientId,
      type: "open",
    });
    wasOpenBefore = !!existingOpen;
  }

  // Update Log collection (creates or increments open/click/unsubscribe docs)
  await Log.findOneAndUpdate({ emailId, recipientId, type }, updateData, {
    upsert: true,
  });

  // Update per-campaign collection
  const PerCampaignModel = campaignConn.model(emailId, logSchema, emailId);
  await PerCampaignModel.findOneAndUpdate(
    { emailId, recipientId, type },
    updateData,
    { upsert: true }
  );

  // Extra: If it's an OPEN and it was the **first** open for this recipient,
  // increment the "sent" row's openCount and Campaign.totalOpened (only once).
  if (type === "open" && !wasOpenBefore) {
    try {
      const sentRow = await PerCampaignModel.findOne({
        recipientId,
        type: "sent",
      });

      if (sentRow && (!sentRow.openCount || sentRow.openCount === 0)) {
        await PerCampaignModel.updateOne(
          { recipientId, type: "sent" },
          { $inc: { openCount: 1 } }
        );
      }

      const Campaign = campaignConn.model(
        "Campaign",
        new mongoose.Schema({}, { strict: false }),
        "Campaign"
      );
      await Campaign.updateOne({ emailId }, { $inc: { totalOpened: 1 } });
    } catch (err) {
      // don't throw — keep logging but avoid breaking the request
      console.error("Error while applying first-open increments:", err);
    }
  }
}

router.get("/track-pixel", async (req, res) => {
  await logEvent(req, "open");
  const pixel = Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
    "base64"
  );
  res.writeHead(200, {
    "Content-Type": "image/gif",
    "Content-Length": pixel.length,
    "Cache-Control": "no-cache, no-store, must-revalidate",
  });
  res.end(pixel);
});

router.get("/track-click", async (req, res) => {
  const { emailId, recipientId, redirect } = req.query;

  try {
    // Always record the click first
    await logEvent(req, "click");

    // If we have campaign + recipient, ensure open exists (click implies open)
    if (emailId && recipientId) {
      // Check global Log collection for an 'open' record
      const openLog = await Log.findOne({ emailId, recipientId, type: "open" });

      if (!openLog) {
        // No open recorded — treat this click as the first open
        await logEvent(req, "open");
        console.log(
          `📩 Click recorded as open for recipient=${recipientId} campaign=${emailId}`
        );
      } else if (openLog.count === 0) {
        // Safety: if an open doc exists but count is 0 (edge case), increment it
        await Log.updateOne(
          { emailId, recipientId, type: "open" },
          { $inc: { count: 1 }, $set: { timestamp: new Date() } }
        );

        // Also ensure per-campaign "sent" row + Campaign totals reflect this first open
        const PerCampaignModel = campaignConn.model(
          emailId,
          logSchema,
          emailId
        );
        const sentRow = await PerCampaignModel.findOne({
          recipientId,
          type: "sent",
        });
        if (sentRow && (!sentRow.openCount || sentRow.openCount === 0)) {
          await PerCampaignModel.updateOne(
            { recipientId, type: "sent" },
            { $inc: { openCount: 1 } }
          );
          const Campaign = campaignConn.model(
            "Campaign",
            new mongoose.Schema({}, { strict: false }),
            "Campaign"
          );
          await Campaign.updateOne({ emailId }, { $inc: { totalOpened: 1 } });
        }
      }
    }

    // 📧 Send thank-you mail
    //   try {
    //     // Find the campaign document to get the listName
    //     const Campaign = campaignConn.model("Campaign", new mongoose.Schema({}, { strict: false }), "Campaign");
    //     const campaignDoc = await Campaign.findOne({ emailId });
    //     let listName = campaignDoc?.listName; // store listName in Campaign when creating campaign

    //     if (listName) {
    //       // Fetch FirstName from contact list
    //       const ContactModel = contactConn.model(listName, new mongoose.Schema({}, { strict: false }), listName);
    //       const contact = await ContactModel.findOne({ Email: recipientId });

    //       const firstName = contact?.FirstName || "there";

    //       const thankYouBody = `
    //         <!DOCTYPE html>
    //         <html>
    //           <body>
    //             <p>Hi ${firstName},</p>
    //             <p>Thank you for clicking our email. We appreciate your interest!</p>
    //           </body>
    //         </html>
    //       `;

    //       const params = {
    //         Destination: { ToAddresses: [recipientId] },
    //         Message: {
    //           Body: { Html: { Charset: "UTF-8", Data: thankYouBody } },
    //           Subject: { Charset: "UTF-8", Data: "Thank you for your interest" },
    //         },
    //         Source: process.env.FROM_EMAIL,
    //       };

    //       await sesClient.send(new SendEmailCommand(params));
    //       console.log(`✅ Sent thank-you email to ${recipientId}`);
    //     } else {
    //       console.warn(`⚠️ No listName found for campaign ${emailId}, cannot send thank-you email`);
    //     }
    //   } catch (err) {
    //     console.error(`❌ Failed to send thank-you email to ${recipientId}:`, err);
    //   }
    // }

    const target = redirect || "https://demandmediabpm.com/";
    return res.redirect(target);
  } catch (err) {
    console.error("❌ Error in /track-click:", err);
    // fallback redirect
    return res.redirect(redirect || "https://demandmediabpm.com/");
  }
});

const campaignProgress = {}; // { [emailId]: { sent: number, total: number } }

// Helper function with your full existing send logic + batching
async function sendCampaignNow({
  emailId,
  subject,
  body,
  style,
  listName,
  redirectUrl,
}) {
  const campaignSchema = new mongoose.Schema(
    {
      emailId: String,
      subject: String,
      totalSent: Number,
      totalBounced: Number,
      totalOpened: Number,
      totalClicked: Number,
      totalUnsubscribed: Number,
      status: String,
      createdAt: Date,
    },
    { strict: false }
  );

  // Batch config
  // const BATCH_SIZE = parseInt(process.env.CAMPAIGN_BATCH_SIZE || "100", 10);
  // const BATCH_DELAY_MS = parseInt(process.env.CAMPAIGN_BATCH_DELAY_MS || "30000", 10); // 30 sec delay
  // const CONCURRENCY = parseInt(process.env.CAMPAIGN_CONCURRENCY || "10", 10); // parallel sends in a batch

  const BATCH_SIZE = parseInt(process.env.CAMPAIGN_BATCH_SIZE || "4", 10);
  const BATCH_DELAY_MS = parseInt(
    process.env.CAMPAIGN_BATCH_DELAY_MS || "30000",
    10
  ); // 30 sec delay
  const CONCURRENCY = parseInt(process.env.CAMPAIGN_CONCURRENCY || "2", 10); // parallel sends in a batch

  // Helpers
  function chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async function promisePool(items, worker, concurrency) {
    const results = new Array(items.length);
    let i = 0;
    const workers = new Array(Math.min(concurrency, items.length))
      .fill(null)
      .map(async () => {
        while (true) {
          const idx = i++;
          if (idx >= items.length) break;
          try {
            results[idx] = await worker(items[idx], idx);
          } catch (err) {
            results[idx] = { ok: false, error: err?.message || String(err) };
          }
        }
      });
    await Promise.all(workers);
    return results;
  }

  try {
    const ContactModel = contactConn.model(
      listName,
      new mongoose.Schema({}, { strict: false }),
      listName
    );
    const recipients = await ContactModel.find({}, { Email: 1, FirstName: 1 });

    if (!recipients.length) {
      console.warn(`No recipients found for campaign ${emailId}`);
      return;
    }

    campaignProgress[emailId] = {
      sent: 0,
      total: recipients.length,
      status: "pending",
    };

    const Campaign = campaignConn.model("Campaign", campaignSchema, "Campaign");
    await Campaign.updateOne(
      { emailId },
      {
        $set: {
          totalSent: recipients.length,
          status: "pending",
        },
      }
    );

    const PerCampaignModel = campaignConn.model(emailId, logSchema, emailId);
    await PerCampaignModel.insertMany(
      recipients.map(({ Email }) => ({
        emailId,
        recipientId: Email,
        type: "sent",
        timestamp: new Date(),
        sendAt: new Date(),
        count: 0,
        ip: "NA",
        city: "NA",
        region: "NA",
        country: "NA",
        device: "NA",
        browser: "NA",
        os: "NA",
        bounceStatus: "NA",
        unsubscribe: false,
        openCount: 0,
        clickCount: 0,
        lastClickTime: null,
      })),
      { ordered: false }
    );

    await Log.insertMany(
      recipients.map(({ Email }) => ({
        emailId,
        recipientId: Email,
        type: "sent",
        timestamp: new Date(),
        sendAt: new Date(),
        count: 0,
        bounceStatus: "NA",
      })),
      { ordered: false }
    );

    // ---- BATCHED SENDING ----
    const batches = chunkArray(recipients, BATCH_SIZE);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(
        `➡️ Sending batch ${batchIndex + 1}/${batches.length} — ${
          batch.length
        } recipients`
      );

      const worker = async ({ Email: to, FirstName }) => {
        if (!to) return;

        const pixelUrl = `https://truenotsendr.com/api/campaign/track-pixel?emailId=${encodeURIComponent(
          emailId
        )}&recipientId=${encodeURIComponent(to)}&t=${Date.now()}`;
        const clickUrl = `https://truenotsendr.com/api/campaign/track-click?emailId=${encodeURIComponent(
          emailId
        )}&recipientId=${encodeURIComponent(to)}&redirect=${encodeURIComponent(
          redirectUrl
        )}`;
        const unsubscribeUrl = `https://truenotsendr.com/api/campaign/track-unsubscribe?emailId=${encodeURIComponent(
          emailId
        )}&recipientId=${encodeURIComponent(to)}`;

        let fullHtml = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${subject}</title>
    <style>${style || ""}</style>
  </head>
  <body>
    ${body}
  </body>
</html>
`;

        fullHtml = fullHtml
          .replace(/{{firstName}}/g, FirstName || "there")
          .replace(/{{unsubscribeUrl}}/g, unsubscribeUrl)
          .replace(/{{trackingPixelUrl}}/g, pixelUrl)
          .replace(/{{clickUrl}}/g, clickUrl);

        const htmlBody = juice(fullHtml);

        const params = {
          Destination: { ToAddresses: [to] },
          Message: {
            Body: { Html: { Charset: "UTF-8", Data: htmlBody } },
            Subject: { Charset: "UTF-8", Data: subject },
          },
          Source: process.env.FROM_EMAIL,
          Tags: [{ Name: "campaign", Value: emailId }],
        };

        try {
          const sendResult = await sesClient.send(new SendEmailCommand(params));
          const messageId = sendResult.MessageId;

          console.log(`✅ Email sent to ${to} with MessageId ${messageId}`);

          await campaignConn.collection("MessageIdMap").insertOne({
            messageId,
            emailId,
            recipientId: to,
            timestamp: new Date(),
          });

          const exactSendTime = new Date();
          await Promise.all([
            Log.updateOne(
              {
                emailId,
                recipientId: { $regex: `^${to}$`, $options: "i" },
                type: "sent",
              },
              { $set: { sendAt: exactSendTime } }
            ),
            campaignConn.collection(emailId).updateOne(
              {
                emailId,
                recipientId: { $regex: `^${to}$`, $options: "i" },
                type: "sent",
              },
              { $set: { sendAt: exactSendTime } }
            ),
          ]);

          campaignProgress[emailId].sent += 1;
          await Campaign.updateOne(
            { emailId },
            { $set: { sentCount: campaignProgress[emailId].sent } }
          );
        } catch (err) {
          console.error(`❌ Failed to send to ${to}:`, err.message);
        }
      };

      await promisePool(batch, worker, CONCURRENCY);

      if (batchIndex < batches.length - 1) {
        console.log(`⏳ Waiting ${BATCH_DELAY_MS}ms before next batch...`);
        await sleep(BATCH_DELAY_MS);
      }
    }

    // ---- COMPLETE ----
    campaignProgress[emailId].status = "completed";
    await Campaign.updateOne({ emailId }, { $set: { status: "completed" } });

    // Auto-mark NA → Yes after 30 seconds
    setTimeout(async () => {
      try {
        const interactedRecipients = await Log.distinct("recipientId", {
          emailId,
          type: { $in: ["open", "click", "unsubscribe"] },
        });

        await Promise.all([
          Log.updateMany(
            {
              emailId,
              bounceStatus: "NA",
              type: "sent",
              recipientId: { $nin: interactedRecipients },
            },
            { $set: { bounceStatus: "soft" } }
          ),
          campaignConn.collection(emailId).updateMany(
            {
              bounceStatus: "NA",
              type: "sent",
              recipientId: { $nin: interactedRecipients },
            },
            { $set: { bounceStatus: "soft" } }
          ),
        ]);

        console.log(`✅ Auto-marked NA → Yes for campaign ${emailId}`);
      } catch (err) {
        console.error(`❌ Auto-mark NA → Yes failed for ${emailId}`, err);
      }
    }, 30000);
  } catch (err) {
    console.error("❌ sendCampaignNow error:", err);
  }
}

// Main route with scheduling
router.post("/send-campaign", async (req, res) => {
  const { emailId, subject, body, style, listName, redirectUrl, scheduleTime } =
    req.body;
  if (!emailId || !subject || !body || !listName)
    return res.status(400).json({ error: "Missing fields" });

  const campaignSchema = new mongoose.Schema(
    {
      emailId: String,
      subject: String,
      body: String,
      style: String,
      listName: String,
      redirectUrl: String,
      totalSent: Number,
      totalBounced: Number,
      totalOpened: Number,
      totalClicked: Number,
      totalUnsubscribed: Number,
      status: String, // scheduled | running | completed
      createdAt: Date,
      scheduleTime: Date,
    },
    { strict: false }
  );

  const Campaign = campaignConn.model("Campaign", campaignSchema, "Campaign");

  try {
    const isScheduled = scheduleTime && new Date(scheduleTime) > new Date();

    const newCampaign = await Campaign.create({
      emailId,
      subject,
      body,
      style,
      listName,
      redirectUrl,
      totalSent: 0,
      totalBounced: 0,
      totalOpened: 0,
      totalClicked: 0,
      totalUnsubscribed: 0,
      status: isScheduled ? "scheduled" : "running",
      createdAt: new Date(),
      scheduleTime: isScheduled ? new Date(scheduleTime) : null,
    });

    // 🔹 If scheduled, use node-schedule for precise timing
    if (isScheduled) {
      schedule.scheduleJob(new Date(scheduleTime), async () => {
        console.log(`⏰ Running scheduled campaign: ${emailId}`);

        await Campaign.updateOne(
          { _id: newCampaign._id },
          { $set: { status: "running" } }
        );

        await sendCampaignNow({
          // campaignId: newCampaign._id, // 👈 important
          emailId,
          subject,
          body,
          style,
          listName,
          redirectUrl,
        });

        await Campaign.updateOne(
          { _id: newCampaign._id },
          { $set: { status: "completed" } }
        );
      });

      return res.json({
        message: `Campaign scheduled for ${scheduleTime}`,
        // campaignId: newCampaign._id,
      });
    }

    // 🔹 Immediate send
    await sendCampaignNow({
      // campaignId: newCampaign._id, // 👈 important
      emailId,
      subject,
      body,
      style,
      listName,
      redirectUrl,
    });

    await Campaign.updateOne(
      { _id: newCampaign._id },
      { $set: { status: "completed" } }
    );

    return res.json({
      message: `Campaign ${emailId} sent immediately`,
      // campaignId: newCampaign._id,
    });
  } catch (err) {
    console.error("❌ /send-campaign error:", err);
    res.status(500).json({ error: "Failed to send campaign" });
  }
});

// Add at the top
// const progressMap = {}; // { emailId: { sent: 0, total: 0 } }

// New route for SSE
router.get("/send-campaign-progress", async (req, res) => {
  const { emailId } = req.query;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();

  const sendProgress = async () => {
    let progress = campaignProgress[emailId];
    if (!progress) {
      // Fallback to DB
      const Campaign = campaignConn.model(
        "Campaign",
        new mongoose.Schema({}, { strict: false }),
        "Campaign"
      );
      const campaignDoc = await Campaign.findOne({ emailId });
      if (campaignDoc) {
        progress = {
          sent: campaignDoc.sentCount || 0,
          total: campaignDoc.totalSent || 0,
          status: campaignDoc.status || "pending",
        };
      }
    }
    if (progress) {
      res.write(`data: ${JSON.stringify(progress)}\n\n`);
    }
  };

  const interval = setInterval(sendProgress, 1000);
  req.on("close", () => clearInterval(interval));
});

router.post("/mark-bounce", async (req, res) => {
  let { emailId, recipientId, status } = req.body;

  if (!emailId || !recipientId || !status) {
    return res.status(400).json({ error: "Missing emailId or recipientId" });
  }

  try {
    console.log(
      `Mark bounce requested for emailId='${emailId}', recipientId='${recipientId}', status='${status}'`
    );

    // Check if the campaign collection exists
    const collections = await campaignConn.db.listCollections().toArray();
    if (!collections.some((c) => c.name === emailId)) {
      console.warn(`Collection ${emailId} does NOT exist`);
      // Optionally: return here if you want strict check
      return res.status(404).json({ error: "Campaign collection not found" });
    }

    // Check if recipient exists in campaign collection (case insensitive)
    const docBefore = await campaignConn.collection(emailId).findOne({
      recipientId: { $regex: `^${recipientId}$`, $options: "i" },
    });
    if (!docBefore) {
      console.warn(
        `No matching document found in ${emailId} for recipientId ${recipientId}`
      );
      // Optional: return here if you want strict check
      return res.status(404).json({ error: "Recipient not found in campaign" });
    }

    const logResult = await Log.updateMany(
      // { recipientId: { $regex: `^${recipientId}$`, $options: "i" } },
      { emailId, recipientId: { $regex: `^${recipientId}$`, $options: "i" } },
      // { $set: { bounceStatus: "Yes" } }
      { $set: { bounceStatus: status  } }
    );

    const campaignResult = await campaignConn
      .collection(emailId)
      .updateMany(
        { recipientId: { $regex: `^${recipientId}$`, $options: "i" } },
        // { $set: { bounceStatus: "Yes" } }
        { $set: { bounceStatus: status } }
      );

    console.log(`Updated bounceStatus:
      Logs: ${logResult.modifiedCount}
      Campaign: ${campaignResult.modifiedCount}`);

    return res.json({ success: true });
  } catch (error) {
    console.error("mark-bounce error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/ses-webhook", express.text({ type: "*/*" }), async (req, res) => {
  try {
    let message = req.body;
    if (typeof message === "string") {
      try {
        message = JSON.parse(message);
      } catch (err) {
        console.error("❌ Failed to parse incoming string body", err);
        return res.status(400).send("Invalid JSON");
      }
    }

    // Handle SNS subscription confirmation
    if (message.Type === "SubscriptionConfirmation" && message.SubscribeURL) {
      await axios.get(message.SubscribeURL); // Auto-confirm subscription
      console.log("✅ SNS Subscription confirmed");
      return res.status(200).send("Subscription confirmed");
    }

    // Handle bounce or delivery notifications
    if (message.Type === "Notification") {
      const payload = JSON.parse(message.Message);
      // console.log("📩 Full SES payload:", JSON.stringify(payload, null, 2));

      if (
        payload.notificationType === "Bounce" ||
        payload.notificationType === "Delivery"
      ) {
        const recipient =
          payload.bounce?.bouncedRecipients?.[0]?.emailAddress ||
          payload.delivery?.recipients?.[0];
        let emailId = payload.mail.tags?.campaign?.[0];
        const messageId = payload.mail.messageId;

        if (!emailId) {
          const mapping = await campaignConn
            .collection("MessageIdMap")
            .findOne({ messageId });
          if (mapping) emailId = mapping.emailId;
        }

        if (emailId && recipient) {
          // const status = payload.notificationType === "Bounce" ? "Yes" : "No";       
          // const bounceType = payload.bounce?.bounceType; // "Permanent" | "Transient" | "Undetermined"
          // const status = bounceType === "Permanent" ? "hard" : "soft";
          let status;
          if (payload.notificationType === "Bounce") {
            const bounceType = payload.bounce?.bounceType; // Permanent | Transient | Undetermined
            status = bounceType === "Permanent" ? "hard" : "soft";
          } else if (payload.notificationType === "Delivery") {
            status = "no"; // delivered
          }

          await Promise.all([
            Log.updateMany(
              {
                emailId,
                recipientId: { $regex: `^${recipient}$`, $options: "i" },
              },
              { $set: { bounceStatus: status } }
            ),
            campaignConn
              .collection(emailId)
              .updateMany(
                { recipientId: { $regex: `^${recipient}$`, $options: "i" } },
                { $set: { bounceStatus: status } }
              ),
          ]);
          // console.log(
          //   `✅ ${
          //     status === "Yes" ? "Bounce" : "Delivery"
          //   } marked for ${recipient} in campaign ${emailId}`
          // );
          console.log(`✅ ${status} marked for ${recipient} in campaign ${emailId}`);
        } else {
          console.warn(
            `⚠️ ${payload.notificationType} for ${recipient} but emailId missing. MessageId: ${messageId}`
          );
        }
      }
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("❌ /ses-webhook error:", err.message);
    res.status(500).send("Webhook processing failed");
  }
});

router.get("/campaign-analytics", async (req, res) => {
  const { emailId } = req.query;

  const [opens, clicks, unsubscribes] = await Promise.all([
    Log.find({ emailId, type: "open" }),
    Log.find({ emailId, type: "click" }),
    Log.find({ emailId, type: "unsubscribe" }),
  ]);

  const campaignCollection = campaignConn.collection(emailId);
  // const recipients = await campaignCollection.distinct("recipientId");
  const resolvedRecipients = await campaignCollection.distinct("recipientId", {
    bounceStatus: { $in: ["Yes", "No"] },
  });

  const bounces = await campaignCollection.distinct("recipientId", {
    bounceStatus: "Yes",
  });

  const unsubscribeCount = unsubscribes.length;
  const uniqueOpens = opens.length;
  const totalOpens = opens.reduce((sum, o) => sum + o.count, 0);
  const uniqueClicks = clicks.length;
  const totalClicks = clicks.reduce((sum, c) => sum + c.count, 0);
  // const totalSent = recipients.length;
  const totalSent = resolvedRecipients.length;
  const openRate = totalSent ? (uniqueOpens / totalSent) * 100 : 0;
  const clickRate = totalSent ? (uniqueClicks / totalSent) * 100 : 0;
  const bounceRate = totalSent ? (bounces.length / totalSent) * 100 : 0;

  // 🔁 Replace lastActivity calculation with createdAt from Campaign model
  const campaignSchema = new mongoose.Schema({}, { strict: false });
  const Campaign = campaignConn.model("Campaign", campaignSchema, "Campaign");
  const campaign = await Campaign.findOne({ emailId });

  const lastActivity = campaign?.createdAt || null;

  res.json({
    emailId,
    totalSent,
    uniqueOpens,
    totalOpens,
    uniqueClicks,
    totalClicks,
    openRate,
    clickRate,
    bounceRate,
    unsubscribeCount,
    lastActivity,
  });
});

router.get("/campaign-details", async (req, res) => {
  const { emailId } = req.query;
  const CampaignModel = campaignConn.model(emailId, logSchema, emailId);
  const logs = await CampaignModel.find();

  const details = {};
  // Get authoritative bounce status per recipient from "sent" logs
  const sentStatuses = {};
  for (const sentLog of logs.filter((l) => l.type === "sent")) {
    sentStatuses[sentLog.recipientId] = sentLog.bounceStatus;
  }

  for (const log of logs) {
    const r = log.recipientId;
    if (!details[r]) {
      details[r] = {
        emailId,
        recipient: r,
        ip: "NA",
        city: "NA",
        region: "NA",
        country: "NA",
        device: "NA",
        browser: "NA",
        os: "NA",
        totalOpen: 0,
        totalClick: 0,
        lastClick: "NA",
        sendAt: "NA",
        bounceStatus: false,
        unsubscribe: false,
      };
    }
    if (log.type === "sent") details[r].sendAt = log.sendAt || "NA";

    if (log.type === "open") details[r].totalOpen += log.count;
    if (log.type === "click") {
      details[r].totalClick += log.count;
      details[r].lastClick = log.timestamp || "NA";
      details[r].ip = log.ip || "NA";
      details[r].city = log.city || "NA";
      details[r].region = log.region || "NA";
      details[r].country = log.country || "NA";
      details[r].device = log.device || "NA";
      details[r].browser = log.browser || "NA";
      details[r].os = log.os || "NA";
    }
    if (log.type === "unsubscribe") {
      details[r].unsubscribe = true;
    }

    const status = sentStatuses[r] || "NA";
    if (status === "Yes") {
      details[r].bounceStatus = "Yes";
    } else if (status === "No") {
      details[r].bounceStatus = "No";
    } else {
      details[r].bounceStatus = "NA";
    }
  }
  res.json(Object.values(details));
});

router.get("/campaign-ids", async (_, res) => {
  const collections = await campaignConn.db.listCollections().toArray();
  const ids = collections
    .map((c) => c.name)
    .filter(
      (name) =>
        name.toLowerCase() !== "logs" &&
        name.toLowerCase() !== "campaign" &&
        name.toLowerCase() !== "messageidmap"
    );
  res.json(ids);
});

router.get("/contact-lists", async (_, res) => {
  try {
    const collections = await contactConn.db.listCollections().toArray();
    const names = collections.map((c) => c.name);
    res.json(names);
  } catch (err) {
    console.error("❌ /contact-lists error:", err.message);
    res.status(500).json({ error: "Server error", message: err.message });
  }
});

// router.get("/track-unsubscribe", async (req, res) => {
//   await logEvent(req, "unsubscribe");
//   res.send("You have been unsubscribed from this campaign.");
// });

router.get("/track-unsubscribe", async (req, res) => {
  try {
    await logEvent(req, "unsubscribe");
    const { emailId, recipientId } = req.query;
    if (!emailId || !recipientId) {
      return res.status(400).send("Missing params");
    }

    // 1. Find Campaign (for CampaignName + listName)
    const Campaign = campaignConn.model("Campaign", new mongoose.Schema({}, { strict: false }), "Campaign");
    const campaignDoc = await Campaign.findOne({ emailId });
    const listName = campaignDoc?.listName;
    const campaignName = emailId;

    if (listName) {
      // 2. Find user in original contact list
      const ContactModel = contactConn.model(listName, new mongoose.Schema({}, { strict: false }), listName);
      const contact = await ContactModel.findOne({ Email: recipientId });

      if (contact) {
        // 3. Insert into unsubscribelist
        await UnsubscribeList.create({
          FirstName: contact.FirstName || "",
          LastName: contact.LastName || "",
          Email: contact.Email,
          ContactNo: contact.ContactNo || "",
          JobTitle: contact.JobTitle || "",
          CompanyName: contact.CompanyName || "",
          CampaignName: campaignName,
          LinkedIn: contact.LinkdinLink || "",
          UnsubscribeOn: new Date()
        });

        // 4. Also update unsubscribed field in contact list if needed
        await ContactModel.updateOne(
          { Email: recipientId },
          { $set: { Unsubscribed: true, UnsubscribeOn: new Date() } }
        );
      }
    }

    res.send("You have been unsubscribed. ✅");
  } catch (err) {
    console.error("❌ Unsubscribe error:", err);
    res.status(500).send("Failed to unsubscribe");
  }
});


router.post("/send-test-mail", async (req, res) => {
  const { sender, receiver, subject, body, style } = req.body;

  if (!sender || !receiver || !subject || !body) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const juice = require("juice");

  const pixelUrl = "https://via.placeholder.com/1"; // dummy tracking pixel
  const unsubscribeUrl = "https://example.com/unsubscribe";
  const clickUrl = "https://example.com/click-test";

  let fullHtml = `
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="UTF-8" />
      <title>${subject}</title>
      <style>${style || ""}</style>
    </head>
    <body>
      ${body}
    </body>
  </html>`;

  fullHtml = fullHtml
    .replace(/{{firstName}}/g, "Tester")
    .replace(/{{unsubscribeUrl}}/g, unsubscribeUrl)
    .replace(/{{trackingPixelUrl}}/g, pixelUrl)
    .replace(/{{clickUrl}}/g, clickUrl);

  const htmlBody = juice(fullHtml);

  const params = {
    Destination: { ToAddresses: [receiver] },
    Message: {
      Body: {
        Html: {
          Charset: "UTF-8",
          Data: htmlBody,
        },
      },
      Subject: { Charset: "UTF-8", Data: subject },
    },
    Source: sender,
  };

  try {
    await sesClient.send(new SendEmailCommand(params));
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Test mail send error:", err.message);
    res.status(500).json({ error: "Test mail failed" });
  }
});

const { Parser } = require("json2csv");

router.get("/campaign-csv", async (req, res) => {
  const { emailId } = req.query;
  if (!emailId) return res.status(400).json({ error: "Missing emailId" });

  try {
    const CampaignModel = campaignConn.model(emailId, logSchema, emailId);
    const logs = await CampaignModel.find();

    const details = {};
    for (const log of logs) {
      const r = log.recipientId;
      if (!details[r]) {
        details[r] = {
          Campaign: emailId,
          Recipient: r,
          Bounced: "No",
          IP: "NA",
          City: "NA",
          Region: "NA",
          Country: "NA",
          Device: "NA",
          Browser: "NA",
          OS: "NA",
          TotalClick: 0,
          TotalOpen: 0,
          LastClick: "NA",
          Unsubscribed: "No",
        };
      }
      if (log.type === "open") details[r].TotalOpen += log.count;
      if (log.type === "click") {
        details[r].TotalClick += log.count;
        details[r].LastClick = log.timestamp?.toISOString() || "NA";
        details[r].IP = log.ip || "NA";
        details[r].City = log.city || "NA";
        details[r].Region = log.region || "NA";
        details[r].Country = log.country || "NA";
        details[r].Device = log.device || "NA";
        details[r].Browser = log.browser || "NA";
        details[r].OS = log.os || "NA";
      }
      if (log.type === "unsubscribe") {
        details[r].Unsubscribed = "Yes";
      }

      if (log.bounceStatus === "Yes") {
        details[r].Bounced = "Yes";
      } else if (log.bounceStatus === "No") {
        details[r].Bounced = "No";
      } else {
        details[r].Bounced = "NA";
      }
    }

    const parser = new Parser();
    const csv = parser.parse(Object.values(details));

    res.header("Content-Type", "text/csv");
    res.attachment(`${emailId}_data.csv`);
    res.send(csv);
  } catch (err) {
    console.error("CSV export error:", err.message);
    res.status(500).json({ error: "Failed to generate CSV" });
  }
});

router.get("/myip", (req, res) => {
  const realIp =
    req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || req.ip;
  res.json({
    realIp,
    req_ip: req.ip,
    remoteAddress: req.connection?.remoteAddress,
    socketAddress: req.socket?.remoteAddress,
    headers: req.headers,
  });
});

module.exports = router;
