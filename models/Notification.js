const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  // User who performed the action
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  userName: {
    type: String,
    required: true
  },
  userRole: {
    type: String,
    required: true,
    enum: ['fieldAgent', 'auditor', 'admin']
  },
  
  // Admin who should receive this notification
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  adminName: {
    type: String,
    required: false // Admin name (for field agent/auditor actions)
  },
  
  // Action details
  action: {
    type: String,
    required: true,
    enum: ['viewed', 'verified', 'searched', 'permission_request']
  },
  vehicleNumber: {
    type: String,
    required: true
  },
  vehicleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ExcelVehicle',
    required: false
  },
  
  // File information
  excelFileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ExcelFile',
    required: false
  },
  fileName: {
    type: String,
    required: false // Real file name (for primary admin/owner)
  },
  maskedFileName: {
    type: String,
    required: false // Masked file name (for non-primary admins)
  },
  primaryAdminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false // Primary admin of the file
  },
  primaryAdminName: {
    type: String,
    required: false // Primary admin name (shown when maskedFileName is used)
  },
  fileUploaderRole: {
    type: String,
    enum: ['superSuperAdmin', 'superAdmin', 'admin'],
    required: false
  },
  
  // Location details
  ipAddress: {
    type: String,
    required: true
  },
  location: {
    city: String,
    region: String,
    country: String,
    latitude: Number,
    longitude: Number,
    timezone: String,
    isp: String
  },
  
  // Status
  isRead: {
    type: Boolean,
    default: false
  },
  isOnline: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Index for efficient queries
notificationSchema.index({ admin: 1, createdAt: -1 });
notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ isRead: 1, admin: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
