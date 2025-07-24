// const mongoose = require("mongoose");

// const emailLogSchema = new mongoose.Schema({
//   email: String,
//   status: String,
//   timestamp: Date,
//   domain: String,
//   domainProvider: String,
//   isDisposable: Boolean,
//   isFree: Boolean,
//   isRoleBased: Boolean,
//   score: Number,
//   createdAt: {
//     type: Date,
//     default: Date.now
//   },
//   expiresAt: {
//     type: Date,
//     default: null
//   }
// });

// // TTL index only for valid & unknown emails
// emailLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// module.exports = mongoose.model("EmailLog", emailLogSchema);



const mongoose = require("mongoose");

const EmailLogSchema = new mongoose.Schema({
  email: String,
  status: String,
  domain: String,
  domainProvider: String,
  isDisposable: Boolean,
  isFree: Boolean,
  isRoleBased: Boolean,
  score: Number,
  timestamp: Date,
  expiresAt: Date
}, { timestamps: true }); // <== This line adds createdAt and updatedAt

module.exports = mongoose.model("EmailLog", EmailLogSchema);

