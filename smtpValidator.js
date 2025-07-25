const dns = require("dns").promises;
const SMTPConnection = require("smtp-connection");
const fs = require("fs");
const path = require("path");

// ✅ Load a list of disposable domains (trimmed for demo, replace with full list)
const disposableDomains = fs
  .readFileSync(path.join(__dirname, "disposable_email_list.txt"), "utf8")
  .split(/\r?\n/)
  .filter(Boolean);

const roleBasedUsernames = [
  "admin", "support", "info", "contact", "help",
  "sales", "marketing", "billing", "hr", "careers", "Finance"
];

const freeEmailDomains = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com"];

function getDomain(email) {
  return email.split("@")[1].toLowerCase();
}

function getUsername(email) {
  return email.split("@")[0].toLowerCase();
}

async function smtpCheck(email, mxHost) {
  return await new Promise((resolve) => {
    const connection = new SMTPConnection({
      host: mxHost,
      port: 25,
      secure: false,
      tls: { rejectUnauthorized: false },
      socketTimeout: 10000,
    });

    connection.on("error", (err) => {
      console.error(`SMTP error for ${email}:`, err.message);
      resolve(false);
    });

    connection.connect(() => {
      connection.login({}, () => {
        connection.send(
          {
            from: "validator@" + getDomain(email),
            to: [email],
          },
          "",
          (err) => {
            connection.quit();
            if (err && err.code === "EENVELOPE") {
              resolve(false); // recipient rejected
            } else {
              resolve(true); // accepted
            }
          }
        );
      });
    });
  });
}

async function validateSMTP(email) {
  const domain = getDomain(email);
  const username = getUsername(email);
  let isValid = false;
  let isCatchAll = false;

  try {
    const mxRecords = await dns.resolveMx(domain);
    if (!mxRecords.length) throw new Error("No MX records found");
    mxRecords.sort((a, b) => a.priority - b.priority);
    const mxHost = mxRecords[0].exchange;

    isValid = await smtpCheck(email, mxHost);

    const fakeEmail = `randomcheck${Date.now()}@${domain}`;
    isCatchAll = await smtpCheck(fakeEmail, mxHost);
  } catch (err) {
    console.warn(`DNS or SMTP failed for ${email}:`, err.message);
  }

  const isDisposable = disposableDomains.includes(domain);
  const isFree = freeEmailDomains.includes(domain);
  const isRoleBased = roleBasedUsernames.includes(username);

  // 🔢 Scoring
  let score = 100;
  if (!isValid) score -= 50;
  if (isCatchAll) score -= 20;
  if (isDisposable) score -= 40;
  if (isFree) score -= 10;
  if (isRoleBased) score -= 10;
  if (score < 0) score = 0;

  // 🧠 Category
  let category, status;
  if (isValid && !isCatchAll) {
    category = "valid";
    status = "✅ Valid";
  } else if (isValid && isCatchAll) {
    category = "risky";
    status = "⚠️ Risky (Catch-All)";
  } else if (!isValid && isCatchAll) {
    category = "unknown";
    status = "❔ Unknown (Catch-All)";
  } else {
    category = "invalid";
    status = "❌ Invalid";
  }

  return {
    email,
    smtp: isValid,
    catchAll: isCatchAll,
    isDisposable,
    isFree,
    isRoleBased,
    domain,
    category,
    status,
    score
  };
}

module.exports = { validateSMTP };
 