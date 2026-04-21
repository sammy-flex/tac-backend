// models/index.js
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

// ── USER ─────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  name:          { type: String, required: true, trim: true },
  sex:           { type: String, enum: ['Male','Female'], required: true },
  email:         { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone:         { type: String, required: true, unique: true, trim: true },
  password:      { type: String, required: true, minlength: 6 },
  role:          { type: String, enum: ['admin','officer','finance'], default: 'officer' },
  phoneVerified: { type: Boolean, default: false },
  isActive:      { type: Boolean, default: true },
  lastLogin:     { type: Date },
  createdAt:     { type: Date, default: Date.now }
});
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});
userSchema.methods.comparePassword = async function(p) {
  return await bcrypt.compare(p, this.password);
};
userSchema.methods.toSafeObject = function() {
  const o = this.toObject(); delete o.password; return o;
};

// ── OTP ──────────────────────────────────────────────────
const otpSchema = new mongoose.Schema({
  phone:     { type: String, required: true },
  code:      { type: String, required: true },
  purpose:   { type: String, enum: ['signup','reset','verify','finance'], required: true },
  used:      { type: Boolean, default: false },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
});
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// ── PARTICIPANT ───────────────────────────────────────────
const participantSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  gender:      { type: String, enum: ['Male','Female'], required: true },
  adminArea:   { type: String, enum: ['Koforidua','Suhum','New Tafo','Nkurakan','Nsawam','Others'], required: true },
  district:    { type: String, trim: true },
  category:    { type: String, enum: ['Junior Youth','Senior Youth','Young Adult','Facilitator/Patron','Youth Pastor','Area Committee Member','Elder','Deaconess','Other'], required: true },
  status:      { type: String, enum: ['Resident','Non-Resident'], required: true },
  language:    { type: String, enum: ['English','Twi','Others'] },
  contactNumber:  { type: String, trim: true },
  contactName:    { type: String, required: true, trim: true },
  contactLocation:{ type: String, required: true, trim: true },
  contactMobile:  { type: String, required: true, trim: true },
  declarationAgreed: { type: Boolean, required: true, default: false },
  smsSent:     { type: Boolean, default: false },
  smsError:    { type: String },
  bulkImport:  { type: Boolean, default: false },
  registeredBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  registeredByName: { type: String },
  createdAt:   { type: Date, default: Date.now },
  updatedAt:   { type: Date }
});
participantSchema.index({ name: 1, contactMobile: 1 }, { unique: true });

// ── TRANSACTION (Finance) ─────────────────────────────────
const transactionSchema = new mongoose.Schema({
  type:        { type: String, enum: ['income','expenditure'], required: true },
  date:        { type: Date, required: true },
  category:    { type: String, required: true },
  subCategory: { type: String },   // for subcommittee payments
  description: { type: String, required: true, trim: true },
  amount:      { type: Number, required: true, min: 0 },
  area:        { type: String },
  reference:   { type: String, trim: true },
  recordedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recordedByName:  { type: String },
  createdAt:   { type: Date, default: Date.now },
  updatedAt:   { type: Date }
});

// ── SYSTEM SETTINGS ───────────────────────────────────────
const systemSettingsSchema = new mongoose.Schema({
  key:           { type: String, unique: true, required: true },
  value:         { type: mongoose.Schema.Types.Mixed },
  updatedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedByName: { type: String },
  updatedAt:     { type: Date, default: Date.now },
  note:          { type: String }
});

// ── AUDIT LOG ─────────────────────────────────────────────
const auditLogSchema = new mongoose.Schema({
  action:          { type: String, required: true },
  performedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  performedByName: { type: String },
  performedByRole: { type: String },
  targetId:        { type: String },
  targetName:      { type: String },
  details:         { type: mongoose.Schema.Types.Mixed },
  ip:              { type: String },
  createdAt:       { type: Date, default: Date.now }
});

module.exports = {
  User:           mongoose.model('User',           userSchema),
  OTP:            mongoose.model('OTP',            otpSchema),
  Participant:    mongoose.model('Participant',    participantSchema),
  Transaction:    mongoose.model('Transaction',   transactionSchema),
  SystemSettings: mongoose.model('SystemSettings',systemSettingsSchema),
  AuditLog:       mongoose.model('AuditLog',       auditLogSchema),
};
