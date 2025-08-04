// // code of currunt truesendr

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
 













// changes for aws
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
//   "admin", "support", "info", "contact", "help",
//   "sales", "marketing", "billing", "hr", "careers", "finance"
// ];

// const freeEmailDomains = [
//   "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com"
// ];

// function getDomain(email) {
//   return email.split("@")[1].toLowerCase();
// }

// function getUsername(email) {
//   return email.split("@")[0].toLowerCase();
// }

// // Dummy domain bounce rate tracker — replace with DB or cache lookup
// const domainBounceRates = {
//   "nextbike.net": 1.0,
//   "demandmediabpm.com": 0.4,
// };

// function shouldSkipDomain(domain) {
//   const bounceRate = domainBounceRates[domain] || 0;
//   return bounceRate >= 0.8;
// }

// async function smtpCheck(email, mxHost, timeout = 5000) {
//   return await Promise.race([
//     new Promise((resolve) => {
//       const connection = new SMTPConnection({
//         host: mxHost,
//         port: parseInt(process.env.AWS_SMTP_PORT || "587"),
//         requireTLS: true,
//         tls: { rejectUnauthorized: false },
//         socketTimeout: timeout - 500, // prevent double timeout with race
//       });

//       connection.on("error", (err) => {
//         console.error(`SMTP error for ${email}:`, err.message);
//         resolve(null); // timeout or other failure
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
//                 resolve(false);
//               } else {
//                 resolve(true);
//               }
//             }
//           );
//         });
//       });
//     }),

//     new Promise((resolve) =>
//       setTimeout(() => {
//         console.warn(`⏱️ SMTP timeout for ${email}`);
//         resolve(null);
//       }, timeout)
//     ),
//   ]);
// }

// async function validateSMTP(email) {
//   const domain = getDomain(email);
//   const username = getUsername(email);

//   let isValid = null;
//   let isCatchAll = false;

//   // Skip validation for bad domain
//   if (shouldSkipDomain(domain)) {
//     console.log(`🚫 Skipping email from bad domain (${domain}), bounceRate: ${domainBounceRates[domain]}`);
//     return {
//       email,
//       smtp: null,
//       catchAll: false,
//       isDisposable: disposableDomains.includes(domain),
//       isFree: freeEmailDomains.includes(domain),
//       isRoleBased: roleBasedUsernames.includes(username),
//       domain,
//       category: "unknown",
//       status: "❔ Skipped (High Bounce)",
//       score: 0,
//     };
//   }

//   try {
//     const mxRecords = await dns.resolveMx(domain);
//     if (!mxRecords.length) throw new Error("No MX records found");
//     mxRecords.sort((a, b) => a.priority - b.priority);
//     const mxHost = mxRecords[0].exchange;

//     isValid = await smtpCheck(email, mxHost, 5000);

//     const fakeEmail = `randomcheck${Date.now()}@${domain}`;
//     isCatchAll = await smtpCheck(fakeEmail, mxHost, 5000);
//   } catch (err) {
//     console.warn(`DNS or SMTP failed for ${email}:`, err.message);
//   }

//   const isDisposable = disposableDomains.includes(domain);
//   const isFree = freeEmailDomains.includes(domain);
//   const isRoleBased = roleBasedUsernames.includes(username);

//   // Scoring
//   let score = 100;
//   if (isValid === false) score -= 50;
//   if (isCatchAll) score -= 20;
//   if (isDisposable) score -= 40;
//   if (isFree) score -= 10;
//   if (isRoleBased) score -= 10;
//   if (score < 0) score = 0;

//   let category, status;
//   if (isValid === true && !isCatchAll) {
//     category = "valid";
//     status = "✅ Valid";
//   } else if (isValid === true && isCatchAll) {
//     category = "risky";
//     status = "⚠️ Risky (Catch-All)";
//   } else if (isValid === null) {
//     category = "unknown";
//     status = "❔ Unknown (Timeout)";
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
//     score,
//   };
// }

// module.exports = { validateSMTP };
