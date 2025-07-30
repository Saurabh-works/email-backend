require('dotenv').config();
const credentials = {};
const userPerms = {}; // username => ['single'] or ['single', 'bulk']

function loadUsers(envString, permissions) {
  if (!envString) return;
  const pairs = envString.split(",");
  for (const pair of pairs) {
    const [username, password] = pair.split(":");
    if (username && password) {
      credentials[username] = password;
      userPerms[username] = permissions;
    }
  }
} 

// Load from .env
loadUsers(process.env.FULL_USERS, ["single", "bulk"]);
loadUsers(process.env.LIMITED_USERS, ["single"]);



//.............................................................................................................


// Load SSL certificate and key




const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const http = require("http");
const campaignApi = require("./campaignApi");
// const https = require('https');
const RegionStat = require("./models/RegionStats");
const WebSocket = require("ws");
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const dns = require("dns").promises;
const multer = require("multer");
const xlsx = require("xlsx");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { validateSMTP } = require("./smtpValidator");
const DomainReputation = require("./models/DomainReputation");
const sessionEmailMap = new Map(); // email => sessionId

const mongoose = require("mongoose");
const EmailLog = require("./models/EmailLog");
const contactApi = require("./contactApi");
const mailpreviewApi = require('./mailpreviewApi');

// const sslOptions = {
//   key: fs.readFileSync("./localhost-key.pem"),
//   cert: fs.readFileSync("./localhost.pem"),
// };

// const sslOptions = {
//   key: fs.readFileSync("C:/Windows/System32/localhost.pem"),
//   cert: fs.readFileSync("C:/Windows/System32/localhost-key.pem"),
// };

const app = express();
const PORT = 5000;
const server = http.createServer(app);
// const server = https.createServer(sslOptions, app); // changes by saurabh
const wss = new WebSocket.Server({ server });
// const ws = new WebSocket.Server({ server });



const regions = [
  process.env.AWS_REGION,
  process.env.AWS_REGION_EAST2,
  process.env.AWS_REGION_WEST1,
  // process.env.AWS_REGION_AP
];

let regionStats = [];

mongoose.connect(process.env.MONGO_URI).then(async () => {
  console.log("✅ Connected to MongoDB");
  const existingStats = await RegionStat.find({ region: { $in: regions } });
  regionStats = regions.map(region => {
    const match = existingStats.find(r => r.region === region);
    return match || new RegionStat({ region, sent: 0, bounces: 0 });
  });
}).catch((err) => {
  console.error("❌ MongoDB connection error:", err);
});

setInterval(() => {
  console.log("🧭 Region Stats:", regionStats);
}, 300000); // log every 5 minutes

app.use((req, res, next) => {
  if (req.headers['x-amz-sns-message-type']) {
    bodyParser.text({ type: '*/*' })(req, res, next);
  } else {
    bodyParser.json()(req, res, next);
  }
});


// const allowedOrigins = ["https://localhost:3000", "https://truesendr.com"];

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5000",
  "https://localhost:3000",
  "https://truesendr.com",
  "https://truesendr-ui.vercel.app",
  "https://77fd70c33625.ngrok-free.app",
  "https://13.218.96.234:5000",
  "https://truenotsendr.com"
];


// app.use(cors({
//   origin: function (origin, callback) {
//     if (
//       !origin || 
//       allowedOrigins.includes(origin) || 
//       allowRegex.some(regex => regex.test(origin))
//     ) {
//       callback(null, true);
//     } else {
//       console.error("⛔ CORS blocked origin:", origin);
//       callback(new Error("Not allowed by CORS"));
//     }
//   },
//   credentials: true,
// }));

// app.use(cors({
//   origin: allowedOrigins,
//   credentials: true,
//   allowedHeaders: [
//     "Content-Type",
//     "ngrok-skip-browser-warning"
//   ]
// }));

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error("⛔ CORS blocked origin:", origin);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "ngrok-skip-browser-warning"
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // Allow preflight requests




const upload = multer({ dest: "uploads/" });
let clients = new Set();
let validationResults = {};

const sessionClients = new Map(); // sessionId => WebSocket
const disposableDomains = ["mailinator.com", "tempmail.com", "10minutemail.com"];
const freeEmailProviders = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com"];
const roleBasedEmails = ["admin", "support", "info", "contact", "help", "sales", "development"];

wss.on("connection", (ws) => {
  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.sessionId) {
        sessionClients.set(data.sessionId, ws);
      }
    } catch (e) {
      console.error("Invalid WebSocket message:", e.message);
    }
  });

  ws.on("close", () => {
    for (const [sessionId, clientWs] of sessionClients.entries()) {
      if (clientWs === ws) {
        sessionClients.delete(sessionId);
        break;
      }
    }
  });
});


function extractDomain(email) {
  if (!email || !email.includes("@")) return "N/A";
  return email.split("@")[1].toLowerCase();
}

async function detectProviderByMX(domain) {
  try {
    const records = await dns.resolveMx(domain);
    const mxHosts = records.map(r => r.exchange.toLowerCase()).join(", ");
    if (mxHosts.includes("google.com")) return "Gmail / Google Workspace";
    if (mxHosts.includes("outlook.com") || mxHosts.includes("protection.outlook.com")) return "Outlook / Microsoft 365";
    if (mxHosts.includes("zoho.com")) return "Zoho Mail";
    if (mxHosts.includes("yahoodns.net")) return "Yahoo Mail";
    if (mxHosts.includes("protonmail")) return "ProtonMail";
    return `Custom / Unknown Provider [${mxHosts.split(",")[0]}]`;
  } catch {
    return "Unavailable";
  }
}

function calculateEmailScore({ status, isDisposable, isFree, isRoleBased }) {
  let score = 100;

  if (status.includes("❌") || status.includes("Unknown")) score -= 50;
  if (status.includes("Risky")) score -= 25; // ⚠️ Reduce score for risky/catch-all

  if (isDisposable) score -= 30;
  if (isFree) score -= 10;
  if (isRoleBased) score -= 10;

  return Math.max(score, 0);
}


function sendProgressToFrontend(current, total, sessionId = null) {
  const msg = JSON.stringify({ type: "progress", current, total });
  if (sessionId && sessionClients.has(sessionId)) {
    const ws = sessionClients.get(sessionId);
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  } else {
    clients.forEach(client => client.readyState === WebSocket.OPEN && client.send(msg));
  }
}


function sendStatusToFrontend(email, status, timestamp, details, sessionId = null) {
  const score = calculateEmailScore({ status, ...details });
  const expiresAt = status.includes("Valid") || status.includes("Unknown")
    ? new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
    : null;

  const msgObj = {
    email,
    status,
    timestamp,
    domain: details.domain || "N/A",
    domainProvider: details.provider || "N/A",
    isDisposable: !!details.isDisposable,
    isFree: !!details.isFree,
    isRoleBased: !!details.isRoleBased,
    score,
    expiresAt
  };

  validationResults[email] = msgObj;
  const message = JSON.stringify(msgObj);

  if (sessionId && sessionClients.has(sessionId)) {
    const ws = sessionClients.get(sessionId);
    if (ws.readyState === WebSocket.OPEN) ws.send(message);
  } else {
    clients.forEach(client => client.readyState === WebSocket.OPEN && client.send(message));
  }

  new EmailLog(msgObj).save();
}



function getBounceRate(stat) {
  return stat.sent > 0 ? (stat.bounces / stat.sent) * 100 : 0;
}

function getBestRegion() {
  const override = process.env.FORCE_SES_REGION;

  // Only use override if it's explicitly set and not empty or 'null'
  if (override && override.trim() !== "" && override !== "null") {
    console.log("🚨 Forcing SES region override:", override);
    return override;
  }

  // Normal logic: pick region with bounce rate < 4.5%
  for (let stat of regionStats) {
    if (getBounceRate(stat) < 4.5) return stat.region;
  }

  return process.env.AWS_REGION;
}


async function incrementStat(region, type) {
  const target = regionStats.find(r => r.region === region);
  if (!target) return;
  if (type === "sent") target.sent++;
  if (type === "bounce") target.bounces++;
  await RegionStat.updateOne({ region }, { $inc: { [type]: 1 } }, { upsert: true });
}

app.get("/", (req, res) => {
  res.send('Backend is running!');
});

app.post("/send-email", async (req, res) => {
  try {
    const { email, sessionId } = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    if (sessionId) {
    sessionEmailMap.set(email, sessionId);
    }

    if (!email) return res.status(400).json({ error: "Email is required" });

    const domain = extractDomain(email);

    // 🧠 Step 1: Domain-level bounce analysis
    const domainStats = await DomainReputation.findOne({ domain });
    if (domainStats && domainStats.sent >= 5) {
      const bounceRate = domainStats.invalid / domainStats.sent;
      if (bounceRate >= 0.6) {
        console.log(`🚫 Skipping email from bad domain (${domain}), bounceRate: ${bounceRate.toFixed(2)}`);
        sendStatusToFrontend(email, "⚠️ Risky (High Bounce Domain)", null, {
          domain,
          provider: await detectProviderByMX(domain),
          isDisposable: disposableDomains.includes(domain),
          isFree: freeEmailProviders.includes(domain),
          isRoleBased: roleBasedEmails.includes(email.split("@")[0].toLowerCase())
        });
        return res.status(200).json({ skipped: true, reason: "High bounce domain" });
      }
    }

    // 🧠 Step 2: Cache lookup
    const cached = await EmailLog.findOne({ email }).sort({ createdAt: -1 });

if (cached) {
  const ageMs = Date.now() - new Date(cached.createdAt).getTime();
  const isFresh = ageMs < 10 * 24 * 60 * 60 * 1000; // 10 days

  const isValidType = (
    cached.status.includes("✅") ||
    cached.status.includes("⚠️") ||
    cached.status.includes("Unknown")
  );

  // ✅ If Valid, Risky, Unknown → check freshness
  // ✅ If Invalid → reuse permanently
  if ((isValidType && isFresh) || cached.status.includes("❌")) {
    console.log("📦 Using cached validation result for", email);
    sendStatusToFrontend(email, cached.status, cached.timestamp, {
      domain: cached.domain,
      provider: cached.domainProvider,
      isDisposable: cached.isDisposable,
      isFree: cached.isFree,
      isRoleBased: cached.isRoleBased
    }, sessionId);
    return res.json({ success: true, cached: true });
  }
}



    // 🧠 Step 3: SMTP validation
    const smtpResult = await validateSMTP(email);

    // ❌ 3.a: If invalid → directly block
    if (smtpResult.category === "invalid") {
      console.log("⛔ Not sending (invalid):", smtpResult.status);
      sendStatusToFrontend(email, smtpResult.status, null, smtpResult);
      return res.status(200).json({ skipped: true, reason: "SMTP invalid" });
    }

    // ⚠️ 3.b: If risky
    if (smtpResult.category === "risky") {
      const previouslySent = await EmailLog.findOne({ email });

      if (previouslySent) {
        console.log("⛔ Not sending (risky, already attempted):", smtpResult.status);
        sendStatusToFrontend(email, smtpResult.status, null, smtpResult);
        return res.status(200).json({ skipped: true, reason: "SMTP risky (already tried)" });
      }

      console.log("⚠️ First-time risky (catch-all) — sending allowed. Waiting for SES result.");
      // 🚫 DO NOT send WebSocket update yet — wait for webhook
    }

    // 🧠 Step 4: Send email via SES
    const region = getBestRegion();
    console.log("📤 Using SES region:", region);

    const dynamicSES = new SESClient({
      region,
      credentials: {
        accessKeyId: process.env.AWS_SMTP_USER,
        secretAccessKey: process.env.AWS_SMTP_PASS
      }
    });

    const params = {
      Source: process.env.VERIFIED_EMAIL,
      Destination: { ToAddresses: [email] },
      Message: {
        Subject: { Data: "Hope this finds you well 😊" },
        Body: {
          Text: {
            Data: `Hey there!\n\nJust wanted to say a quick hello and check if everything’s going smoothly.\nFeel free to get in touch anytime — we’re always here to help.\n\nWarm wishes,\nJenny\nTeam TrueSendr`
          }
        }
      }
    };

    await dynamicSES.send(new SendEmailCommand(params));
    await incrementStat(region, "sent");

    // ⚡️ Don't send frontend result now → frontend will wait for webhook
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error in /send-email:", err.message);
    res.status(500).json({ error: err.message });
  }
});



app.post("/ses-webhook", async (req, res) => {
  try {
    console.log("📥 SNS Webhook Hit");
    const snsMessage = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    if (snsMessage.Type === "SubscriptionConfirmation") {
      console.log("🔗 Confirming SNS subscription...");
      await axios.get(snsMessage.SubscribeURL);
      return res.status(200).send("Subscription confirmed");
    }

    if (snsMessage.Type === "Notification") {
      console.log("🔔 Notification received");
      const messageBody = typeof snsMessage.Message === "string" ? JSON.parse(snsMessage.Message) : snsMessage.Message;
      const email = messageBody.mail.destination[0];
      const sessionId = sessionEmailMap.get(email);
      sessionEmailMap.delete(email); // clean up

      const timestamp = messageBody.bounce?.timestamp || messageBody.mail.timestamp;
      const notificationType = messageBody.notificationType;
      const domain = extractDomain(email);

      const cached = await EmailLog.findOne({ email }).sort({ createdAt: -1 });

      // 🚫 If cached email was marked as "⚠️ Risky (High Bounce Domain)", ignore notification
      if (cached && cached.status === "⚠️ Risky (High Bounce Domain)") {
        console.log(`⚠️ Ignored SNS notification for high bounce domain risky email: ${email}`);
        return res.status(200).send("Ignored High Bounce Risky Email");
      }

      const provider = await detectProviderByMX(domain);
      const isDisposable = disposableDomains.includes(domain);
      const isFree = freeEmailProviders.includes(domain);
      const isRoleBased = roleBasedEmails.includes(email.split("@")[0].toLowerCase());

      const status = notificationType === "Delivery" ? "✅ Valid Email" : "❌ Invalid Email";

      // Track domain reputation
      const statUpdate = notificationType === "Bounce"
        ? { $inc: { sent: 1, invalid: 1 } }
        : { $inc: { sent: 1 } };

      await DomainReputation.updateOne(
        { domain },
        statUpdate,
        { upsert: true }
      );

      if (notificationType === "Bounce") {
        const region = getBestRegion();
        await incrementStat(region, "bounce");
      }

      // ✅ Only update frontend if NOT a risky high bounce domain
      sendStatusToFrontend(email, status, timestamp, {
      domain,
      provider,
      isDisposable,
      isFree,
      isRoleBased
    }, sessionId);


      return res.status(200).send("OK");
    }

    return res.status(200).send("Ignored non-notification SNS message");
  } catch (error) {
    console.error("❌ SNS Webhook Error:", error.message);
    return res.status(400).send("Bad Request");
  }

});


// 🧾 Return a clean Excel Template
app.get("/download-template", (req, res) => {
  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.json_to_sheet([{ Email: "" }]);
  xlsx.utils.book_append_sheet(workbook, worksheet, "Template");

  const buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Disposition", "attachment; filename=email_template.xlsx");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(buffer);
});



//📥 Bulk Upload Excel
app.post("/upload-excel", upload.single("file"), async (req, res) => {
  const sessionId = req.body.sessionId;

  if (!req.file) return res.status(400).send("No file uploaded");

  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);

    const emailCol = Object.keys(data[0]).find(col =>
      col.toLowerCase().includes("email")
    );
    if (!emailCol) return res.status(400).send("No email column found");

    const total = data.length;
    for (let i = 0; i < total; i++) {
      const row = data[i];
      const email = row[emailCol];

      const cached = await EmailLog.findOne({ email }).sort({ createdAt: -1 });
      let result;

      const ageMs = Date.now() - new Date(cached?.createdAt || 0).getTime();
      const isFresh = ageMs < 10 * 24 * 60 * 60 * 1000; // 10 days
      const isValidType =
        cached?.status?.includes("✅") ||
        cached?.status?.includes("⚠️") ||
        cached?.status?.includes("Unknown");

      if (cached && ((isValidType && isFresh) || cached.status.includes("❌"))) {
        result = cached;
      } else {
        try {
          const params = {
            Source: process.env.VERIFIED_EMAIL,
            Destination: { ToAddresses: [email] },
            Message: {
              Subject: { Data: "Validation Check" },
              Body: { Text: { Data: "Test email for validation." } },
            },
          };
          const region = getBestRegion();
          const dynamicSES = new SESClient({
            region,
            credentials: {
              accessKeyId: process.env.AWS_SMTP_USER,
              secretAccessKey: process.env.AWS_SMTP_PASS,
            },
          });
          await dynamicSES.send(new SendEmailCommand(params));
          await incrementStat(region, "sent");
        } catch (err) {
          validationResults[email] = {
            status: "❌ Send Failed",
            timestamp: null,
          };
        }
        result = await waitForValidation(email);
      }

      // ✅ Risky logic - applies regardless of cache or fresh result
      if (result && result.status.includes("Risky")) {
        const previouslySent = await EmailLog.findOne({ email });

        if (previouslySent) {
          console.log(
            "⛔ Not sending (risky, already attempted):",
            result.status
          );
          sendStatusToFrontend(
            email,
            result.status,
            result.timestamp,
            result,
            sessionId
          );
          continue; // skip Excel write
        }

        console.log(
          "⚠️ First-time risky (catch-all) — sending allowed. Waiting for SES result."
        );
        continue; // don’t log or write result until SNS callback
      }

      // ✅ Write result to Excel only if it's not risky first-time
      const score = calculateEmailScore(result);
      data[i] = {
        Email: email,
        Status: result.status.replace(/^[^a-zA-Z0-9]+/, ""),
        Timestamp: result.timestamp
          ? new Date(result.timestamp).toLocaleString()
          : "N/A",
        Domain: result.domain,
        Provider: result.domainProvider,
        Disposable: result.isDisposable ? "Yes" : "No",
        Free: result.isFree ? "Yes" : "No",
        RoleBased: result.isRoleBased ? "Yes" : "No",
        Score: score,
      };

      sendProgressToFrontend(i + 1, total, sessionId);
    }

    const newSheet = xlsx.utils.json_to_sheet(data);
    const newBook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(newBook, newSheet, "Results");
    const outputPath = path.join(
      __dirname,
      "uploads",
      `result_${Date.now()}.xlsx`
    );
    xlsx.writeFile(newBook, outputPath);

    res.download(outputPath, "validated_emails.xlsx", () => {
      fs.unlinkSync(req.file.path);
      fs.unlinkSync(outputPath);
    });
  } catch (err) {
    console.error("❌ Bulk validation error:", err.message);
    res.status(500).send("Server error during bulk validation");
  }
});


app.get("/region-stats", async (req, res) => {
  try {
    const stats = await RegionStat.find({ region: { $in: regions } });
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch region stats" });
  }
});

app.get("/stats", async (req, res) => {
  try {
    const total = await EmailLog.countDocuments();
    const valid = await EmailLog.countDocuments({ status: /Valid/ });
    const invalid = await EmailLog.countDocuments({ status: /Invalid/ });
    const unknown = await EmailLog.countDocuments({ status: /Unknown/ });
    res.json({ total, valid, invalid, unknown });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

app.use(bodyParser.json());

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  // 2.a) Check credentials map
  if (credentials[username] !== password) {
    return res.status(401).json({ success: false, message: "Invalid credentials" });
  }

  // 2.b) Fetch this user’s permissions (always at least ["single"])
  const perms = userPerms[username] || [];

  // 2.c) Return both success + what they’re allowed to do
  return res.json({
    success:     true,
    message:     "Login successful",
    permissions: perms     // e.g. ["single","bulk"] or ["single"]
  });
});



function waitForValidation(email, timeout = 12000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const result = validationResults[email];
      if (result) return resolve(result);
      if (Date.now() - start > timeout) {
        const domain = extractDomain(email);
        detectProviderByMX(domain).then(provider => {
          const details = {
            domain,
            provider,
            isDisposable: disposableDomains.includes(domain),
            isFree: freeEmailProviders.includes(domain),
            isRoleBased: roleBasedEmails.includes(email.split("@")[0].toLowerCase())
          };
          const status = "❔ Unknown";
          sendStatusToFrontend(email, status, null, details);
          resolve(validationResults[email]);
        });
        return;
      }
      setTimeout(check, 500);
    };
    check();
  });
}


// from this saurabh's code start

app.use("/api/contact", contactApi);



app.use("/api/campaign", campaignApi);

app.use('/api/preview', mailpreviewApi);

// server.js or smtpValidator.js
module.exports = { validateSMTP, sessionClients };


server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
// server.listen(PORT, () => console.log(`🔒 HTTPS Server running at https://localhost:${PORT}`));  //changes by saurabh
