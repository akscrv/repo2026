const mongoose = require('mongoose');

const excelFileSchema = new mongoose.Schema({
  filename: {
    type: String,
    required: [true, 'Filename is required'],
    trim: true
  },
  originalName: {
    type: String,
    required: [true, 'Original filename is required'],
    trim: true
  },
  fileSize: {
    type: Number,
    required: [true, 'File size is required']
  },
  mimeType: {
    type: String,
    required: [true, 'MIME type is required'],
    default: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Uploader is required']
  },
  // Keep assignedTo for backward compatibility (will store the primary admin)
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Primary assigned admin is required']
  },
  // New field for multiple admin assignments (for SuperAdmin uploads)
  assignedAdmins: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  // Admin-to-admin file sharing (when admin shares their own files with other admins)
  sharedAdmins: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  totalRows: {
    type: Number,
    default: 0
  },
  processedRows: {
    type: Number,
    default: 0
  },
  failedRows: {
    type: Number,
    default: 0
  },
  skippedRows: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['processing', 'completed', 'failed', 'partial'],
    default: 'processing'
  },
  errorMessage: {
    type: String,
    default: null
  },
  filePath: {
    type: String,
    required: [true, 'File path is required']
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Index for better query performance
excelFileSchema.index({ uploadedBy: 1, createdAt: -1 });
excelFileSchema.index({ assignedTo: 1, createdAt: -1 });
excelFileSchema.index({ assignedAdmins: 1, createdAt: -1 });
excelFileSchema.index({ sharedAdmins: 1, createdAt: -1 });
excelFileSchema.index({ status: 1 });

// Pre-save middleware to ensure assignedTo is always the first admin in assignedAdmins
excelFileSchema.pre('save', function(next) {
  if (this.assignedAdmins && this.assignedAdmins.length > 0) {
    // Ensure assignedTo is always the first admin in the array
    if (!this.assignedAdmins.includes(this.assignedTo)) {
      this.assignedAdmins.unshift(this.assignedTo);
    }
  } else if (this.assignedTo) {
    // If assignedAdmins is empty but assignedTo exists, initialize it
    this.assignedAdmins = [this.assignedTo];
  }
  next();
});

module.exports = mongoose.model('ExcelFile', excelFileSchema); 