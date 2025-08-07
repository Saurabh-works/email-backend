require("dotenv").config();
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
// const multer = require("multer");
// const { validateSMTP } = require("./smtpValidator");

const mongoose = require("mongoose");
const EmailLog = require("./models/EmailLog");
const contactApi = require("./contactApi");
const mailpreviewApi = require("./mailpreviewApi");

// const sslOptions = {
//   key: fs.readFileSync("./localhost-key.pem"),
//   cert: fs.readFileSync("./localhost.pem"),
// };

// const sslOptions = {
//   key: fs.readFileSync("C:/Windows/System32/localhost.pem"),
//   cert: fs.readFileSync("C:/Windows/System32/localhost-key.pem"),
// };

const app = express();
// app.set("trust proxy", true); // ✅ Add this line it should forward the original visitor IP
// app.set('trust proxy', 'loopback');
app.set('trust proxy', ['loopback', 'uniquelocal', 'linklocal']);

// app.set('trust proxy', function (ip) {
//   // Trust only if from loopback or specific known ranges
//   return ip === '127.0.0.1' || ip === '::1';
// });




// app.set("trust proxy", 2); // Trust 2 proxies: Netlify and Nginx
// app.use((req, res, next) => {
//   console.log("---- FULL DEBUG ----");
//   console.log("req.ip:", req.ip);
//   console.log("X-Forwarded-For:", req.headers["x-forwarded-for"]);
//   console.log("X-Real-IP:", req.headers["x-real-ip"]);
//   console.log("remoteAddress:", req.connection?.remoteAddress);
//   console.log("socketAddress:", req.socket?.remoteAddress);
//   console.log("All headers:", req.headers);
//   console.log("---------------------");
//   next();
// });

app.use((req, res, next) => {
  console.log("Full Headers:", req.headers);
  next();
});

app.set('trust proxy', (ip) => {
  console.log("Incoming request from IP:", ip);
  return true; // Trust all proxies (NGINX, etc.)
});

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

mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("✅ Connected to MongoDB");
    const existingStats = await RegionStat.find({ region: { $in: regions } });
    regionStats = regions.map((region) => {
      const match = existingStats.find((r) => r.region === region);
      return match || new RegionStat({ region, sent: 0, bounces: 0 });
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
  });

setInterval(() => {
  console.log("🧭 Region Stats:", regionStats);
}, 300000); // log every 5 minutes

app.use((req, res, next) => {
  if (req.headers["x-amz-sns-message-type"]) {
    bodyParser.text({ type: "*/*" })(req, res, next);
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
  "https://truenotsendr.com",
  "https://truesendr007.netlify.app",
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
    "ngrok-skip-browser-warning",
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // Allow preflight requests


// wss.on("connection", (ws) => {
//   ws.on("message", (msg) => {
//     try {
//       const data = JSON.parse(msg);
//       if (data.sessionId) {
//         sessionClients.set(data.sessionId, ws);
//       }
//     } catch (e) {
//       console.error("Invalid WebSocket message:", e.message);
//     }
//   });

//   ws.on("close", () => {
//     for (const [sessionId, clientWs] of sessionClients.entries()) {
//       if (clientWs === ws) {
//         sessionClients.delete(sessionId);
//         break;
//       }
//     }
//   });
// });

// function sendProgressToFrontend(current, total, sessionId = null) {
//   const msg = JSON.stringify({ type: "progress", current, total });
//   if (sessionId && sessionClients.has(sessionId)) {
//     const ws = sessionClients.get(sessionId);
//     if (ws.readyState === WebSocket.OPEN) ws.send(msg);
//   } else {
//     clients.forEach(
//       (client) => client.readyState === WebSocket.OPEN && client.send(msg)
//     );
//   }
// }



app.get("/", (req, res) => {
  res.send("Backend is running!");
});


// app.post("/ses-webhook", async (req, res) => {
//   try {
//     console.log("📥 SNS Webhook Hit");

//     const snsMessage =
//       typeof req.body === "string" ? JSON.parse(req.body) : req.body;

//     if (snsMessage.Type === "SubscriptionConfirmation") {
//       console.log("🔗 Confirming SNS subscription...");
//       await axios.get(snsMessage.SubscribeURL);
//       return res.status(200).send("Subscription confirmed");
//     }

//     if (snsMessage.Type === "Notification") {
//       console.log("🔔 Notification received");

//       const messageBody =
//         typeof snsMessage.Message === "string"
//           ? JSON.parse(snsMessage.Message)
//           : snsMessage.Message;

//       const email = messageBody.mail.destination[0];
//       const sessionId = sessionEmailMap.get(email);
//       sessionEmailMap.delete(email); // clean up

//       const timestamp =
//         messageBody.bounce?.timestamp || messageBody.mail.timestamp;
//       const notificationType = messageBody.notificationType;
//       const domain = extractDomain(email);

//       const cached = await EmailLog.findOne({ email }).sort({ createdAt: -1 });

//       // 🚫 If cached email was marked as "⚠️ Risky (High Bounce Domain)", ignore
//       if (cached && cached.status === "⚠️ Risky (High Bounce Domain)") {
//         console.log(
//           `⚠️ Ignored SNS notification for high bounce domain risky email: ${email}`
//         );
//         return res.status(200).send("Ignored High Bounce Risky Email");
//       }

//       const provider = await detectProviderByMX(domain);
//       const isDisposable = disposableDomains.includes(domain);
//       const isFree = freeEmailProviders.includes(domain);
//       const isRoleBased = roleBasedEmails.includes(
//         email.split("@")[0].toLowerCase()
//       );

//       const status =
//         notificationType === "Delivery" ? "✅ Valid Email" : "❌ Invalid Email";
//       const category = status.includes("Valid") ? "valid" : "invalid";

//       // ✅ Save to EmailLog
//       await EmailLog.create({
//         email,
//         domain,
//         domainProvider: provider,
//         isDisposable,
//         isFree,
//         isRoleBased,
//         status,
//         category,
//         timestamp: new Date(timestamp),
//         expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
//       });

//       // 📈 Update domain reputation
//       const statUpdate =
//         notificationType === "Bounce"
//           ? { $inc: { sent: 1, invalid: 1 } }
//           : { $inc: { sent: 1 } };

//       await DomainReputation.updateOne({ domain }, statUpdate, {
//         upsert: true,
//       });

//       if (notificationType === "Bounce") {
//         const region = getBestRegion();
//         await incrementStat(region, "bounce");
//       }

//       // ✅ Emit result to frontend
//       sendStatusToFrontend(
//         email,
//         status,
//         timestamp,
//         {
//           domain,
//           provider,
//           isDisposable,
//           isFree,
//           isRoleBased,
//         },
//         sessionId
//       );

//       return res.status(200).send("OK");
//     }

//     return res.status(200).send("Ignored non-notification SNS message");
//   } catch (error) {
//     console.error("❌ SNS Webhook Error:", error.message);
//     return res.status(400).send("Bad Request");
//   }
// });



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
    return res
      .status(401)
      .json({ success: false, message: "Invalid credentials" });
  }

  // 2.b) Fetch this user’s permissions (always at least ["single"])
  const perms = userPerms[username] || [];

  // 2.c) Return both success + what they’re allowed to do
  return res.json({
    success: true,
    message: "Login successful",
    permissions: perms, // e.g. ["single","bulk"] or ["single"]
  });
});

// from this saurabh's code start

app.use("/api/contact", contactApi);

app.use("/api/campaign", campaignApi);

app.use("/api/preview", mailpreviewApi);

// server.js or smtpValidator.js
// module.exports = { validateSMTP, sessionClients };

server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
// server.listen(PORT, () => console.log(`🔒 HTTPS Server running at https://localhost:${PORT}`));  //changes by saurabh
