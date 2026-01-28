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
    enum: ['fieldAgent', 'auditor']
  },
  
  // Admin who should receive this notification
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Action details
  action: {
    type: String,
    required: true,
    enum: ['viewed', 'verified']
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
