// const dns = require("dns").promises;
// const SMTPConnection = require("smtp-connection");
// const fs = require("fs");
// const path = require("path");

// // ✅ Load a list of disposable domains (trimmed for demo, replace with full list)
// const disposableDomains = fs
//   .readFileSync(path.join(__dirname, "disposable_email_list.txt"), "utf8")
//   .split(/\r?\n/)
//   .filter(Boolean);

// const roleBasedUsernames = [
//   "admin", "support", "info", "contact", "help",
//   "sales", "marketing", "billing", "hr", "careers", "Finance"
// ];

// const freeEmailDomains = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com"];

// function getDomain(email) {
//   return email.split("@")[1].toLowerCase();
// }

// function getUsername(email) {
//   return email.split("@")[0].toLowerCase();
// }

// async function smtpCheck(email, mxHost) {
//   return await new Promise((resolve) => {
//     const connection = new SMTPConnection({
//       host: mxHost,
//       port: 25,
//       secure: false,
//       tls: { rejectUnauthorized: false },
//       socketTimeout: 10000,
//     });

//     connection.on("error", (err) => {
//       console.error(`SMTP error for ${email}:`, err.message);
//       resolve(false);
//     });

//     connection.connect(() => {
//       connection.login({}, () => {
//         connection.send(
//           {
//             from: "validator@" + getDomain(email),
//             to: [email],
//           },
//           "",
//           (err) => {
//             connection.quit();
//             if (err && err.code === "EENVELOPE") {
//               resolve(false); // recipient rejected
//             } else {
//               resolve(true); // accepted
//             }
//           }
//         );
//       });
//     });
//   });
// }

// async function validateSMTP(email) {
//   const domain = getDomain(email);
//   const username = getUsername(email);
//   let isValid = false;
//   let isCatchAll = false;

//   try {
//     const mxRecords = await dns.resolveMx(domain);
//     if (!mxRecords.length) throw new Error("No MX records found");
//     mxRecords.sort((a, b) => a.priority - b.priority);
//     const mxHost = mxRecords[0].exchange;

//     isValid = await smtpCheck(email, mxHost);

//     const fakeEmail = `randomcheck${Date.now()}@${domain}`;
//     isCatchAll = await smtpCheck(fakeEmail, mxHost);
//   } catch (err) {
//     console.warn(`DNS or SMTP failed for ${email}:`, err.message);
//   }

//   const isDisposable = disposableDomains.includes(domain);
//   const isFree = freeEmailDomains.includes(domain);
//   const isRoleBased = roleBasedUsernames.includes(username);

//   // 🔢 Scoring
//   let score = 100;
//   if (!isValid) score -= 50;
//   if (isCatchAll) score -= 20;
//   if (isDisposable) score -= 40;
//   if (isFree) score -= 10;
//   if (isRoleBased) score -= 10;
//   if (score < 0) score = 0;

//   // 🧠 Category
//   let category, status;
//   if (isValid && !isCatchAll) {
//     category = "valid";
//     status = "✅ Valid";
//   } else if (isValid && isCatchAll) {
//     category = "risky";
//     status = "⚠️ Risky (Catch-All)";
//   } else if (!isValid && isCatchAll) {
//     category = "unknown";
//     status = "❔ Unknown (Catch-All)";
//   } else {
//     category = "invalid";
//     status = "❌ Invalid";
//   }

//   return {
//     email,
//     smtp: isValid,
//     catchAll: isCatchAll,
//     isDisposable,
//     isFree,
//     isRoleBased,
//     domain,
//     category,
//     status,
//     score
//   };
// }

// module.exports = { validateSMTP };

// const dns = require("dns").promises;
// const SMTPConnection = require("smtp-connection");
// const fs = require("fs");
// const path = require("path");

// // ✅ Load a list of disposable domains (trimmed for demo, replace with full list)
// const disposableDomains = fs
//   .readFileSync(path.join(__dirname, "disposable_email_list.txt"), "utf8")
//   .split(/\r?\n/)
//   .filter(Boolean);

// const roleBasedUsernames = [
//   "admin", "support", "info", "contact", "help",
//   "sales", "marketing", "billing", "hr", "careers", "Finance"
// ];

// const freeEmailDomains = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com"];

// function getDomain(email) {
//   return email.split("@")[1].toLowerCase();
// }

// function getUsername(email) {
//   return email.split("@")[0].toLowerCase();
// }

// async function smtpCheck(email, mxHost) {
//   return await Promise.race([
//     new Promise((resolve) => {
//       const connection = new SMTPConnection({
//         host: mxHost,
//         port: parseInt(process.env.AWS_SMTP_PORT || "587"),
//         requireTLS: true,
//         tls: { rejectUnauthorized: false },
//         socketTimeout: 10000,
//       });

//       connection.on("error", (err) => {
//         console.error(`SMTP error for ${email}:`, err.message);
//         resolve(false);
//       });

//       connection.connect(() => {
//         connection.login({}, () => {
//           connection.send(
//             {
//               from: "validator@" + getDomain(email),
//               to: [email],
//             },
//             "",
//             (err) => {
//               connection.quit();
//               if (err && err.code === "EENVELOPE") {
//                 resolve(false); // recipient rejected
//               } else {
//                 resolve(true); // accepted
//               }
//             }
//           );
//         });
//       });
//     }),

//     new Promise((resolve) =>
//       setTimeout(() => {
//         console.warn(`SMTP timeout for ${email}`);
//         resolve(false);
//       }, 12000)
//     )
//   ]);
// }

// async function validateSMTP(email) {
//   const domain = getDomain(email);
//   const username = getUsername(email);
//   let isValid = false;
//   let isCatchAll = false;

//   try {
//     const mxRecords = await dns.resolveMx(domain);
//     if (!mxRecords.length) throw new Error("No MX records found");
//     mxRecords.sort((a, b) => a.priority - b.priority);
//     const mxHost = mxRecords[0].exchange;

//     isValid = await smtpCheck(email, mxHost);

//     const fakeEmail = `randomcheck${Date.now()}@${domain}`;
//     isCatchAll = await smtpCheck(fakeEmail, mxHost);
//   } catch (err) {
//     console.warn(`DNS or SMTP failed for ${email}:`, err.message);
//   }

//   const isDisposable = disposableDomains.includes(domain);
//   const isFree = freeEmailDomains.includes(domain);
//   const isRoleBased = roleBasedUsernames.includes(username);

//   // 🔢 Scoring
//   let score = 100;
//   if (!isValid) score -= 50;
//   if (isCatchAll) score -= 20;
//   if (isDisposable) score -= 40;
//   if (isFree) score -= 10;
//   if (isRoleBased) score -= 10;
//   if (score < 0) score = 0;

//   // 🧠 Category
//   let category, status;
//   if (isValid && !isCatchAll) {
//     category = "valid";
//     status = "✅ Valid";
//   } else if (isValid && isCatchAll) {
//     category = "risky";
//     status = "⚠️ Risky (Catch-All)";
//   } else if (!isValid && isCatchAll) {
//     category = "unknown";
//     status = "❔ Unknown (Catch-All)";
//   } else {
//     category = "invalid";
//     status = "❌ Invalid";
//   }

//   return {
//     email,
//     smtp: isValid,
//     catchAll: isCatchAll,
//     isDisposable,
//     isFree,
//     isRoleBased,
//     domain,
//     category,
//     status,
//     score
//   };
// }

// module.exports = { validateSMTP };

















// const dns = require("dns").promises;
// const SMTPConnection = require("smtp-connection");
// const fs = require("fs");
// const path = require("path");

// // Load disposable domains
// const disposableDomains = fs
//   .readFileSync(path.join(__dirname, "disposable_email_list.txt"), "utf8")
//   .split(/\r?\n/)
//   .filter(Boolean);

// const roleBasedUsernames = [
//   "admin",
//   "support",
//   "info",
//   "contact",
//   "help",
//   "sales",
//   "marketing",
//   "billing",
//   "hr",
//   "careers",
//   "finance",
// ];

// const freeEmailDomains = [
//   "gmail.com",
//   "yahoo.com",
//   "outlook.com",
//   "hotmail.com",
//   "aol.com",
// ];

// const domainBounceRates = {
//   "nextbike.net": 1.0,
//   "demandmediabpm.com": 0.4,
// };

// function getDomain(email) {
//   return email.split("@")[1].toLowerCase();
// }

// function getUsername(email) {
//   return email.split("@")[0].toLowerCase();
// }

// function shouldSkipDomain(domain) {
//   const bounceRate = domainBounceRates[domain] || 0;
//   return bounceRate >= 0.8;
// }

// async function smtpCheck(email, mxHost, timeout = 10000) {
//   return await Promise.race([
//     new Promise((resolve) => {
//       const connection = new SMTPConnection({
//         host: mxHost,
//         port: 25,
//         secure: false,
//         tls: { rejectUnauthorized: false },
//         socketTimeout: timeout - 500,
//       });

//       connection.on("error", () => resolve(null));

//       connection.connect(() => {
//         connection.login({}, () => {
//           connection.send(
//             {
//               from: "validator@" + getDomain(email),
//               to: [email],
//             },
//             "",
//             (err) => {
//               connection.quit();
//               if (err && err.code === "EENVELOPE") resolve(false);
//               else resolve(true);
//             }
//           );
//         });
//       });
//     }),

//     new Promise((resolve) => setTimeout(() => resolve(null), timeout)),
//   ]);
// }

// async function validateSMTP(email) {
//   const domain = getDomain(email);
//   const username = getUsername(email);

//   if (shouldSkipDomain(domain)) {
//     return buildResult(
//       email,
//       domain,
//       username,
//       null,
//       false,
//       "❔ Skipped (High Bounce)",
//       "unknown"
//     );
//   }

//   let mxHost;
//   try {
//     const mxRecords = await dns.resolveMx(domain);
//     if (!mxRecords.length) throw new Error("No MX records found");
//     mxRecords.sort((a, b) => a.priority - b.priority);
//     mxHost = mxRecords[0].exchange;
//   } catch (err) {
//     return buildResult(
//       email,
//       domain,
//       username,
//       null,
//       false,
//       "❔ Unknown (DNS Failed)",
//       "unknown"
//     );
//   }

//   const fakeEmail = `randomcheck${Date.now()}@${domain}`;
//   let validResult = null;
//   let catchAllResult = null;

//   try {

//     console.time(`SMTP ${email}`);
//     validResult = await smtpCheck(email, mxHost, 6000);
//     console.timeEnd(`SMTP ${email}`);

//     if (validResult === true) {
//       // Optional: Perform catch-all check only if you want to detect risky domains later
//       catchAllResult = await smtpCheck(fakeEmail, mxHost, 6000);
//     } else {
//       catchAllResult = null;
//     }
//   } catch (err) {
//     console.warn("SMTP check exception:", err.message);
//   } 

//   if (validResult === false) {
//   return buildResult(email, domain, username, false, false, "❌ Invalid", "invalid");
// }

// if (validResult === true && catchAllResult === false) {
//   return buildResult(email, domain, username, true, false, "✅ Valid", "valid");
// }

// if (validResult === true && catchAllResult === true) {
//   return buildResult(email, domain, username, true, true, "⚠️ Risky (Catch-All)", "risky");
// }

// // If valid is true but catchAll is unknown (timeout), still return "Valid"
// if (validResult === true && catchAllResult === null) {
//   return buildResult(email, domain, username, true, null, "✅ Valid", "valid");
// }

// // If valid result is null
// return buildResult(email, domain, username, null, !!catchAllResult, "❔ Unknown (Timeout)", "unknown");
// // return null;
 
// }

// function buildResult(
//   email,
//   domain,
//   username,
//   isValid,
//   isCatchAll,
//   status,
//   category
// ) {
//   const isDisposable = disposableDomains.includes(domain);
//   const isFree = freeEmailDomains.includes(domain);
//   const isRoleBased = roleBasedUsernames.includes(username);

//   let score = 100;
//   if (isValid === false) score -= 50;
//   if (isCatchAll) score -= 20;
//   if (isDisposable) score -= 40;
//   if (isFree) score -= 10;
//   if (isRoleBased) score -= 10;
//   if (score < 0) score = 0;

//   return {
//     email,
//     smtp: isValid,
//     catchAll: isCatchAll,
//     isDisposable,
//     isFree,
//     isRoleBased,
//     domain,
//     category,
//     status,
//     score,
//   };
// }

// module.exports = { validateSMTP };




const dns = require("dns").promises;
const SMTPConnection = require("smtp-connection");
const fs = require("fs");
const path = require("path");

// Load disposable domains
const disposableDomains = fs
  .readFileSync(path.join(__dirname, "disposable_email_list.txt"), "utf8")
  .split(/\r?\n/)
  .filter(Boolean);

const roleBasedUsernames = [
  "admin",
  "support",
  "info",
  "contact",
  "help",
  "sales",
  "marketing",
  "billing",
  "hr",
  "careers",
  "finance",
];

const freeEmailDomains = [
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "aol.com",
];

const domainBounceRates = {
  "nextbike.net": 1.0,
  "demandmediabpm.com": 0.4,
};

function getDomain(email) {
  return email.split("@")[1].toLowerCase();
}

function getUsername(email) {
  return email.split("@")[0].toLowerCase();
}

function shouldSkipDomain(domain) {
  const bounceRate = domainBounceRates[domain] || 0;
  return bounceRate >= 0.8;
}

async function preSMTPCheck(email) {
  const domain = getDomain(email);
  const username = getUsername(email);

  // Disposable domain = bounce
  if (disposableDomains.includes(domain)) return { pass: false };

  // Role-based username = bounce
  if (roleBasedUsernames.includes(username)) return { pass: false };

  // Free email domain = valid (don't bounce)
  if (freeEmailDomains.includes(domain)) return { pass: true };

  // High bounce rate domain = bounce
  if (shouldSkipDomain(domain)) return { pass: false };

  // Basic syntax check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { pass: false };

  // Pass presmtp checks
  return { pass: true };
}

async function smtpCheck(email, mxHost, timeout = 10000) {
  return await Promise.race([
    new Promise((resolve) => {
      const connection = new SMTPConnection({
        host: mxHost,
        port: 25,
        secure: false,
        tls: { rejectUnauthorized: false },
        socketTimeout: timeout - 500,
      });

      connection.on("error", () => resolve(null));

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
              if (err && err.code === "EENVELOPE") resolve(false);
              else resolve(true);
            }
          );
        });
      });
    }),

    new Promise((resolve) => setTimeout(() => resolve(null), timeout)),
  ]);
}

// The main function to call, returns true for bounce/invalid, false for valid
async function validateSMTP(email) {
  // Presmtp quick checks
  const presmtp = await preSMTPCheck(email);
  if (!presmtp.pass) {
    // Presmtp says bounce/invalid
    return true;
  }

  const domain = getDomain(email);

  let mxHost;
  try {
    const mxRecords = await dns.resolveMx(domain);
    if (!mxRecords.length) throw new Error("No MX records found");
    mxRecords.sort((a, b) => a.priority - b.priority);
    mxHost = mxRecords[0].exchange;
  } catch (err) {
    // DNS failure = treat as bounce/invalid
    return true;
  }

  try {
    const isValid = await smtpCheck(email, mxHost, 6000);
    if (isValid === false) return true; // bounce/invalid
    if (isValid === true) return false; // valid
    // Timeout or unknown = treat as bounce to be safe
    return true;
  } catch {
    // Any error treat as bounce
    return true;
  }
}

module.exports = { validateSMTP };
