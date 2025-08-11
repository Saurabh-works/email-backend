require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
// const AWS = require('aws-sdk');
// AWS.config.update({ region: process.env.FORCE_SES_REGION || 'us-east-1' });
const requestIp = require("request-ip");
const uaParser = require("ua-parser-js");
const axios = require("axios");
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
// const { validateSMTP } = require("./smtpValidator");
const juice = require("juice");

const router = express.Router();

// DB Connections
const contactConn = mongoose.createConnection(process.env.MONGO_URI_CONTACT);
const campaignConn = mongoose.createConnection(process.env.CAMPAIGN_DB_URI);

const logSchema = new mongoose.Schema({
  emailId: String,
  recipientId: String,
  type: String,
  count: { type: Number, default: 1 },
  timestamp: Date,
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
  // const ip = requestIp.getClientIp(req) || "";
  const ip = getRealIp(req);
  const ua = req.headers["user-agent"] || "";
  const { emailId, recipientId } = req.query;
  if (!emailId || !recipientId || isBot(ua)) return;

  // 🟡 Allow 'unsubscribe' even without user-agent (headless/email clients)
  if (type !== "unsubscribe" && isBot(ua)) return;

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
        `https://ipinfo.io/${ip}?token=${process.env.IPINFO_TOKEN}`
      )
    ).data;
  } catch {}

  const updateData = {
    $inc: { count: 1 },
    $set: {
      timestamp: new Date(),
      ip,
      city: geo.city || "",
      region: geo.region || "",
      country: geo.country || "",
      device: device.type || "desktop",
      browser: browser.name || "",
      os: os.name || "",
    },
  };

  // 🛑 Prevent accidental bounceStatus overwrite on open/click/unsubscribe
  if (type !== "sent") {
    delete updateData.$set.bounceStatus;
  }

  await Log.findOneAndUpdate({ emailId, recipientId, type }, updateData, {
    upsert: true,
  });
  const CampaignModel = campaignConn.model(emailId, logSchema, emailId);
  await CampaignModel.findOneAndUpdate(
    { emailId, recipientId, type },
    updateData,
    { upsert: true }
  );
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
  await logEvent(req, "click");
  res.redirect("https://demandmediabpm.com/");
});

const campaignProgress = {}; // { [emailId]: { sent: number, total: number } }

router.post("/send-campaign", async (req, res) => {
  const { emailId, subject, body, style, listName } = req.body;
  if (!emailId || !subject || !body || !listName)
    return res.status(400).json({ error: "Missing fields" });

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

  try {
    const ContactModel = contactConn.model(
      listName,
      new mongoose.Schema({}, { strict: false }),
      listName
    );
    const recipients = await ContactModel.find({}, { Email: 1, FirstName: 1 });

    if (!recipients.length)
      return res.status(404).json({ error: "No recipients found" });

    campaignProgress[emailId] = {
      sent: 0,
      total: recipients.length,
      status: "pending",
    };

    const Campaign = campaignConn.model("Campaign", campaignSchema, "Campaign");
    await Campaign.create({
      emailId,
      subject,
      totalSent: recipients.length,
      totalBounced: 0,
      totalOpened: 0,
      totalClicked: 0,
      totalUnsubscribed: 0,
      status: "pending",
      createdAt: new Date(),
    });

    res.json({
      message: `Campaign ${emailId} initialized`,
      totalRecipients: recipients.length,
    });

    const PerCampaignModel = campaignConn.model(emailId, logSchema, emailId);

    await PerCampaignModel.insertMany(
      recipients.map(({ Email }) => ({
        emailId,
        recipientId: Email,
        type: "sent",
        timestamp: new Date(),
        count: 0,
        ip: "NA",
        city: "NA",
        region: "NA",
        country: "NA",
        device: "NA",
        browser: "NA",
        os: "NA",
        // bounceStatus: false,
        bounceStatus: "NA",
        unsubscribe: false,
        openCount: 0,
        clickCount: 0,
        lastClickTime: null,
      }))
    );

    await Log.insertMany(
      recipients.map(({ Email }) => ({
        emailId,
        recipientId: Email,
        type: "sent",
        timestamp: new Date(),
        count: 0,
        // bounceStatus: false,
        bounceStatus: "NA",
      }))
    );

    for (const { Email: to, FirstName } of recipients) {
      if (!to) continue;

      const pixelUrl = `https://truenotsendr.com/api/campaign/track-pixel?emailId=${encodeURIComponent(
        emailId
      )}&recipientId=${encodeURIComponent(to)}&t=${Date.now()}`;
      const clickUrl = `https://truenotsendr.com/api/campaign/track-click?emailId=${encodeURIComponent(
        emailId
      )}&recipientId=${encodeURIComponent(to)}`;
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
        // await sesClient.send(new SendEmailCommand(params));
        // console.log(`✅ Email sent to ${to}`);

        const sendResult = await sesClient.send(new SendEmailCommand(params));
        const messageId = sendResult.MessageId;

        console.log(`✅ Email sent to ${to} with MessageId ${messageId}`);

        // Save MessageId mapping in DB
        await campaignConn.collection("MessageIdMap").insertOne({
          messageId,
          emailId,
          recipientId: to,
          timestamp: new Date(),
        });

        //.........this code i add in friday means saturday morning.
        // --- New: Async validateSMTP check ---
        // validateSMTP(to)
        //   .then(async (isBounce) => {
        //     if (isBounce) {
        //       console.log(`⚠️ Marking bounce for ${to} after SMTP validation`);
        //       // Update bounceStatus true in logs and campaign collection
        //       await Log.updateMany(
        //         { emailId, recipientId: to },
        //         { $set: { bounceStatus: true } }
        //       );
        //       await campaignConn
        //         .collection(emailId)
        //         .updateMany(
        //           { recipientId: to },
        //           { $set: { bounceStatus: true } }
        //         );
        //     }
        //   })
        //   .catch((err) => {
        //     console.error(`SMTP validation error for ${to}:`, err.message);
        //   });
        // till here
        campaignProgress[emailId].sent += 1;
        await Campaign.updateOne(
          { emailId },
          { $set: { sentCount: campaignProgress[emailId].sent } }
        );
      } catch (err) {
        console.error(`❌ Failed to send to ${to}:`, err.message);
      }
    }
    campaignProgress[emailId].status = "completed";
    await Campaign.updateOne({ emailId }, { $set: { status: "completed" } });
    // Auto-mark remaining NA as Yes after 2 minutes
    // Auto-mark remaining NA as Yes after 2 minutes (only if no delivery/open/click)
    setTimeout(async () => {
      try {
        // Only mark as Yes if still NA AND no "open" or "click" events
        // await Promise.all([
        //   Log.updateMany(
        //     {
        //       emailId,
        //       bounceStatus: "NA",
        //       type: "sent", // only sent entries
        //     },
        //     { $set: { bounceStatus: "Yes" } }
        //   ),
        //   campaignConn.collection(emailId).updateMany(
        //     {
        //       bounceStatus: "NA",
        //       type: "sent", // only sent entries
        //     },
        //     { $set: { bounceStatus: "Yes" } }
        //   ),
        // ]);

        // Get list of recipients who have interacted
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
            { $set: { bounceStatus: "Yes" } }
          ),
          campaignConn.collection(emailId).updateMany(
            {
              bounceStatus: "NA",
              type: "sent",
              recipientId: { $nin: interactedRecipients },
            },
            { $set: { bounceStatus: "Yes" } }
          ),
        ]);

        console.log(`✅ Auto-marked NA → Yes for campaign ${emailId}`);
      } catch (err) {
        console.error(`❌ Auto-mark NA → Yes failed for ${emailId}`, err);
      }
    }, 30000);
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
  let { emailId, recipientId } = req.body;

  if (!emailId || !recipientId) {
    return res.status(400).json({ error: "Missing emailId or recipientId" });
  }

  try {
    console.log(
      `Mark bounce requested for emailId='${emailId}', recipientId='${recipientId}'`
    );

    // Check if the campaign collection exists
    const collections = await campaignConn.db.listCollections().toArray();
    if (!collections.some((c) => c.name === emailId)) {
      console.warn(`Collection ${emailId} does NOT exist`);
      // Optionally: return here if you want strict check
      // return res.status(404).json({ error: "Campaign collection not found" });
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
      // return res.status(404).json({ error: "Recipient not found in campaign" });
    }

    // // Update bounceStatus=true in the general Log collection for this recipient
    // const logResult = await Log.updateMany(
    //   { recipientId: { $regex: `^${recipientId}$`, $options: "i" } },
    //   { $set: { bounceStatus: true } }
    // );

    // // Update bounceStatus=true in the campaign-specific collection
    // const campaignResult = await campaignConn
    //   .collection(emailId)
    //   .updateMany(
    //     { recipientId: { $regex: `^${recipientId}$`, $options: "i" } },
    //     { $set: { bounceStatus: true } }
    //   );

    const logResult = await Log.updateMany(
      { recipientId: { $regex: `^${recipientId}$`, $options: "i" } },
      { $set: { bounceStatus: "Yes" } }
    );

    const campaignResult = await campaignConn
      .collection(emailId)
      .updateMany(
        { recipientId: { $regex: `^${recipientId}$`, $options: "i" } },
        { $set: { bounceStatus: "Yes" } }
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
      console.log("📩 Full SES payload:", JSON.stringify(payload, null, 2));

      // if (payload.notificationType === "Bounce") {

      //   const bouncedRecipient =
      //     payload.bounce.bouncedRecipients?.[0]?.emailAddress;
      //   let emailId = payload.mail.tags?.campaign?.[0]; // might be undefined
      //   const messageId = payload.mail.messageId;

      //   if (!emailId) {
      //     // Lookup emailId from your MessageIdMap collection
      //     const mapping = await campaignConn
      //       .collection("MessageIdMap")
      //       .findOne({ messageId });
      //     if (mapping) {
      //       emailId = mapping.emailId;
      //     }
      //   }

      //   if (emailId) {
      //     // Mark bounce in DB
      //     await axios.post(
      //       `https://truenotsendr.com/api/campaign/mark-bounce`,
      //       { emailId, recipientId: bouncedRecipient }
      //     );
      //     console.log(
      //       `✅ Bounce marked for ${bouncedRecipient} in campaign ${emailId}`
      //     );
      //   } else {
      //     console.warn(
      //       `⚠️ Bounce received for ${bouncedRecipient} but emailId (campaign) missing. MessageId: ${messageId}`
      //     );
      //   }
      // }

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
          const status = payload.notificationType === "Bounce" ? "Yes" : "No";
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
          console.log(
            `✅ ${
              status === "Yes" ? "Bounce" : "Delivery"
            } marked for ${recipient} in campaign ${emailId}`
          );
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

  // const bounces = await campaignCollection
  //   .find({ bounceStatus: true })
  //   .toArray();

  // const bounces = await campaignCollection
  //   .find({ bounceStatus: "Yes" })
  //   .toArray();
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
        bounceStatus: false,
        unsubscribe: false,
      };
    }
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

    // if (log.bounceStatus) details[r].bounceStatus = true;
    // if (log.bounceStatus === "Yes") details[r].bounceStatus = true;
    // details[r].bounceStatus = log.bounceStatus || "NA";
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

router.get("/track-unsubscribe", async (req, res) => {
  await logEvent(req, "unsubscribe");
  res.send("You have been unsubscribed from this campaign.");
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
      // if (log.bounceStatus) {
      //   details[r].Bounced = "Yes";
      // }

      // if (log.bounceStatus === "Yes") {
      //   details[r].Bounced = "Yes";
      // }

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

// router.get('/myip', (req, res) => {
//   res.send({
//     ip: req.ip,
//     realIp: req.headers['x-forwarded-for'],
//     allHeaders: req.headers,
//   });
// });

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

// router.get('/myip', (req, res) => {
//   const realIp = req.clientIp || req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.ip;

//   res.json({
//     realIp,
//     req_ip: req.ip,
//     remoteAddress: req.connection?.remoteAddress,
//     socketAddress: req.socket?.remoteAddress,
//     clientIp: req.clientIp,
//     headers: req.headers
//   });
// });

module.exports = router;
