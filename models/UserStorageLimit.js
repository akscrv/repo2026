const mongoose = require('mongoose');

const userStorageLimitSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  totalRecordLimit: {
    type: Number,
    required: true,
    min: 1000, // Minimum 1k records
    max: 10000000 // Maximum 10M records
  },
  description: {
    type: String,
    default: 'Custom individual storage limit'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isCustom: {
    type: Boolean,
    default: true // Always true for individual limits
  }
}, {
  timestamps: true
});

// Create index for userId
userStorageLimitSchema.index({ userId: 1 });
userStorageLimitSchema.index({ isActive: 1 });

// Ensure virtual fields are serialized
userStorageLimitSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    return ret;
  }
});

module.exports = mongoose.model('UserStorageLimit', userStorageLimitSchema);
