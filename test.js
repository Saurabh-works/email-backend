const { validateSMTP } = require("./smtpValidator");

(async () => {
  const result = await validateSMTP("yashwardhan.k@demandmediabpm.com");

  console.log("SMTP Check Result:", result);

  if (result.catchAll) {
    console.log("⚠️ Catch-all domain detected. Marking result as 'Unknown'");
  } else if (result.smtp) {
    console.log("✅ Email is valid");
  } else {
    console.log("❌ Email is invalid");
  }
})();
