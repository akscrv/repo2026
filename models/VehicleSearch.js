const mongoose = require('mongoose');

/**
 * MINIMAL MongoDB Schema - Storage Optimized
 * Stores ONLY search keys (registrationNumber, chassisNumber) and GCS file reference
 * All vehicle data is stored in Google Cloud Storage, NOT MongoDB
 * 
 * Storage Impact:
 * - Old schema: ~500 bytes per vehicle (23 fields + indexes)
 * - New schema: ~100 bytes per vehicle (2 fields + minimal indexes)
 * - Storage reduction: ~80% per vehicle
 */
const vehicleSearchSchema = new mongoose.Schema({
  registrationNumber: {
    type: String,
    maxlength: 100,
    sparse: true, // Only index non-null values
    index: true,
    unique: true
  },
  chassisNumber: {
    type: String,
    maxlength: 100,
    sparse: true, // Only index non-null values
    index: true,
    unique: true
  },
  gcsFileUrl: {
    type: String,
    required: true // Reference to Excel file in GCS
  },
  gcsJsonUrl: {
    type: String,
    required: false // Optional: Reference to parsed JSON data in GCS for faster retrieval
  },
  excelFileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ExcelFile',
    required: true
  },
  rowNumber: {
    type: Number,
    required: true // Row number in original Excel file
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: false, // Disable createdAt/updatedAt to save storage
  versionKey: false, // Disable __v field to save storage
  _id: true // Keep _id for references
});

// MINIMAL INDEXES - Only what's needed for search
// 1. Unique index on registrationNumber (for fast exact match)
vehicleSearchSchema.index({ registrationNumber: 1 }, { 
  unique: true, 
  sparse: true,
  name: 'reg_unique_idx',
  background: true
});

// 2. Unique index on chassisNumber (for fast exact match)
vehicleSearchSchema.index({ chassisNumber: 1 }, { 
  unique: true, 
  sparse: true,
  name: 'chassis_unique_idx',
  background: true
});

// 3. Compound index for multi-field search (registrationNumber OR chassisNumber)
vehicleSearchSchema.index({ 
  registrationNumber: 1, 
  chassisNumber: 1 
}, { 
  sparse: true, 
  name: 'reg_chassis_compound_idx',
  background: true
});

// 4. Index for file-based queries (if needed for admin access)
vehicleSearchSchema.index({ excelFileId: 1, isActive: 1 }, {
  sparse: true,
  name: 'file_active_idx',
  background: true
});

module.exports = mongoose.model('VehicleSearch', vehicleSearchSchema);
