require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
// const AWS = require('aws-sdk');
// AWS.config.update({ region: process.env.FORCE_SES_REGION || 'us-east-1' });
const requestIp = require("request-ip");
const uaParser = require("ua-parser-js");
const axios = require("axios");
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const { validateSMTP } = require("./smtpValidator"); 
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
  bounceStatus: { type: Boolean, default: false },
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

// function getRealIp(req) {
//   const xfwd = req.headers["x-forwarded-for"];
//   if (xfwd) return xfwd.split(",")[0].trim();
//   return (
//     requestIp.getClientIp(req) ||
//     req.connection?.remoteAddress ||
//     req.socket?.remoteAddress ||
//     ""
//   );
// }


// function getRealIp(req) {
//   // ✅ Netlify-specific header (most reliable when coming via Netlify frontend)
//   if (req.headers['x-nf-client-connection-ip']) {
//     return req.headers['x-nf-client-connection-ip'];
//   }

//   // ✅ Standard X-Forwarded-For header (set by proxies like Nginx)
//   if (req.headers['x-forwarded-for']) {
//     return req.headers['x-forwarded-for'].split(',')[0].trim();
//   }

//   // ✅ Standard Express fallback chain
//   return (
//     req.connection?.remoteAddress?.replace(/^::ffff:/, '') ||
//     req.socket?.remoteAddress?.replace(/^::ffff:/, '') ||
//     ''
//   );
// }

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


// router.post("/send-campaign", async (req, res) => {
//   const { emailId, subject, body, style, listName } = req.body;
//   if (!emailId || !subject || !body || !listName)
//     return res.status(400).json({ error: "Missing fields" });

//   // ✅ Define campaignSchema before use
//   const campaignSchema = new mongoose.Schema(
//     {
//       emailId: String,
//       subject: String,
//       totalSent: Number,
//       totalBounced: Number,
//       totalOpened: Number,
//       totalClicked: Number,
//       totalUnsubscribed: Number,
//       createdAt: Date,
//     },
//     { strict: false }
//   );

//   try {
//     const ContactModel = contactConn.model(
//       listName,
//       new mongoose.Schema({}, { strict: false }),
//       listName
//     );
//     const recipients = await ContactModel.find({}, { Email: 1, FirstName: 1 });

//     if (!recipients.length)
//       return res.status(404).json({ error: "No recipients found" });

//     const Campaign = campaignConn.model("Campaign", campaignSchema, "Campaign");
//     await Campaign.create({
//       emailId,
//       subject,
//       totalSent: recipients.length,
//       totalBounced: 0,
//       totalOpened: 0,
//       totalClicked: 0,
//       totalUnsubscribed: 0,
//       createdAt: new Date(),
//     });

//     res.json({
//       message: `Campaign ${emailId} initialized`,
//       totalRecipients: recipients.length,
//     });

//     const PerCampaignModel = campaignConn.model(emailId, logSchema, emailId);

//     await PerCampaignModel.insertMany(
//       recipients.map(({ Email }) => ({
//         emailId,
//         recipientId: Email,
//         type: "sent",
//         timestamp: new Date(),
//         count: 0,
//         ip: "NA",
//         city: "NA",
//         region: "NA",
//         country: "NA",
//         device: "NA",
//         browser: "NA",
//         os: "NA",
//         bounceStatus: false,
//         unsubscribe: false,
//         openCount: 0,
//         clickCount: 0,
//         lastClickTime: null,
//       }))
//     );

//     await Log.insertMany(
//       recipients.map(({ Email }) => ({
//         emailId,
//         recipientId: Email,
//         type: "sent",
//         timestamp: new Date(),
//         count: 0,
//         bounceStatus: false,
//       }))
//     );

//     for (const { Email: to, FirstName } of recipients) {
//       if (!to) continue;

//       let validation = { category: "valid" };
//       try {
//         validation = await validateSMTP(to);
//       } catch (err) {
//         console.error(`SMTP validation failed for ${to}:`, err.message);
//       }

//       const bounceStatus = validation.category === "invalid";

//       const pixelUrl = `http://localhost:5000/api/campaign/track-pixel?emailId=${encodeURIComponent(
//         emailId
//       )}&recipientId=${encodeURIComponent(to)}&t=${Date.now()}`;
//       const clickUrl = `http://localhost:5000/api/campaign/track-click?emailId=${encodeURIComponent(
//         emailId
//       )}&recipientId=${encodeURIComponent(to)}`;
//       const unsubscribeUrl = `http://localhost:5000/api/campaign/track-unsubscribe?emailId=${encodeURIComponent(
//         emailId
//       )}&recipientId=${encodeURIComponent(to)}`;

//       // 💡 Wrap your template body with <style> tag to merge style
//       let fullHtml = `
// <!DOCTYPE html>
// <html>
//   <head>
//     <meta charset="UTF-8" />
//     <meta name="viewport" content="width=device-width, initial-scale=1.0" />
//     <title>${subject}</title>
//     <style>${style || ""}</style>  <!-- Inject GrapesJS CSS here -->
//   </head>
//   <body>
//     ${body}
//   </body>
// </html>
// `;

//       // 🔥 Replace placeholders
//       fullHtml = fullHtml
//         .replace(/{{firstName}}/g, FirstName || "there")
//         .replace(/{{unsubscribeUrl}}/g, unsubscribeUrl)
//         .replace(/{{trackingPixelUrl}}/g, pixelUrl)
//         .replace(/{{clickUrl}}/g, clickUrl); // 👈 insert here

//       // 🧃 Inline styles
//       const htmlBody = juice(fullHtml);

//       const params = {
//         Destination: { ToAddresses: [to] },
//         Message: {
//           Body: { Html: { Charset: "UTF-8", Data: htmlBody } },
//           Subject: { Charset: "UTF-8", Data: subject },
//         },
//         Source: process.env.FROM_EMAIL,
//         Tags: [{ Name: "campaign", Value: emailId }],
//       };

//       try {
//         await sesClient.send(new SendEmailCommand(params));
//         console.log(`✅ Email sent to ${to}`);

//         if (bounceStatus) {
//           await Promise.all([
//             PerCampaignModel.updateOne(
//               { recipientId: to },
//               { $set: { bounceStatus: true } }
//             ),
//             Log.updateOne(
//               { emailId, recipientId: to },
//               { $set: { bounceStatus: true } }
//             ),
//           ]);
//         }
//       } catch (err) {
//         console.error(`❌ Failed to send to ${to}:`, err.message);
//         if (bounceStatus) {
//           await Promise.all([
//             PerCampaignModel.updateOne(
//               { recipientId: to },
//               { $set: { bounceStatus: true } }
//             ),
//             Log.updateOne(
//               { emailId, recipientId: to },
//               { $set: { bounceStatus: true } }
//             ),
//           ]);
//         }
//       }
//     }
//   } catch (err) {
//     console.error("❌ /send-campaign error:", err);
//     res.status(500).json({ error: "Failed to send campaign" });
//   }
// });


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

    const Campaign = campaignConn.model("Campaign", campaignSchema, "Campaign");
    await Campaign.create({
      emailId,
      subject,
      totalSent: recipients.length,
      totalBounced: 0,
      totalOpened: 0,
      totalClicked: 0,
      totalUnsubscribed: 0,
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
        bounceStatus: false,
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
        bounceStatus: false,
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
        await sesClient.send(new SendEmailCommand(params));
        console.log(`✅ Email sent to ${to}`);
      } catch (err) {
        console.error(`❌ Failed to send to ${to}:`, err.message);
      }
    }
  } catch (err) {
    console.error("❌ /send-campaign error:", err);
    res.status(500).json({ error: "Failed to send campaign" });
  }
});


router.post("/mark-bounce", async (req, res) => {
  const { emailId, recipientId } = req.body;
  if (!emailId || !recipientId)
    return res.status(400).json({ error: "Missing emailId or recipientId" });

  await Promise.all([
    Log.updateMany({ recipientId }, { $set: { bounceStatus: true } }),
    campaignConn
      .collection(emailId)
      .updateMany({ recipientId }, { $set: { bounceStatus: true } }),
  ]);

  res.json({ success: true });
});

router.post("/ses-webhook", async (req, res) => {
  try {
    const message =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // 🔐 1. Handle SNS subscription confirmation
    if (message.Type === "SubscriptionConfirmation" && message.SubscribeURL) {
      await axios.get(message.SubscribeURL); // Auto-confirm subscription
      console.log("✅ SNS Subscription confirmed");
      return res.status(200).send("Subscription confirmed");
    }

    // 📩 2. Handle actual bounce notifications
    if (message.Type === "Notification") {
      const payload = JSON.parse(message.Message);

      if (payload.notificationType === "Bounce") {
        const email = payload.mail.destination[0];
        const emailId = payload.mail.tags?.campaign?.[0];

        if (emailId) {
          await axios.post(
            `${process.env.TRACKING_URL}/api/campaign/mark-bounce`,
            { emailId, recipientId: email }
          );
          console.log(`✅ Bounce marked for ${email} in ${emailId}`);
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
  const recipients = await campaignCollection.distinct("recipientId");
  const bounces = await campaignCollection
    .find({ bounceStatus: true })
    .toArray();

  const unsubscribeCount = unsubscribes.length;
  const uniqueOpens = opens.length;
  const totalOpens = opens.reduce((sum, o) => sum + o.count, 0);
  const uniqueClicks = clicks.length;
  const totalClicks = clicks.reduce((sum, c) => sum + c.count, 0);
  const totalSent = recipients.length;
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

    if (log.bounceStatus) details[r].bounceStatus = true;
  }
  res.json(Object.values(details));
});

router.get("/campaign-ids", async (_, res) => {
  const collections = await campaignConn.db.listCollections().toArray();
  const ids = collections
    .map((c) => c.name)
    .filter((name) => name.toLowerCase() !== "logs" && name.toLowerCase() !== "campaign");
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
      if (log.bounceStatus) {
        details[r].Bounced = "Yes";
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

router.get('/myip', (req, res) => {
  res.send({
    ip: getRealIp(req),
    allHeaders: req.headers
  });
});







module.exports = router;
