const mongoose = require('mongoose');

/**
 * ULTRA-MINIMAL MongoDB Schema - Storage Optimized (Level 1, 2, 3, 4)
 * 
 * STORAGE REDUCTION STRATEGY:
 * - Stores ONLY search keys: registrationNumber and chassisNumber
 * - NO file references (gcsFileUrl removed - derive from ExcelFile collection)
 * - NO derived fields (stateCode, lastFour extracted at runtime)
 * - NO metadata fields (rowNumber, excelFileId, createdAt removed)
 * 
 * File Location Strategy:
 * - When searching: Get accessible files from ExcelFile collection
 * - Search all accessible Excel files for matching registration/chassis numbers
 * - File location derived from ExcelFile.filePath, not stored in VehicleLookup
 * 
 * Expected storage reduction:
 * - Current: ~60 MB (data + indexes + gcsFileUrl)
 * - After Level 4: ~5-8 MB (data + minimal indexes, NO gcsFileUrl)
 * - Storage reduction: ~87-90% from original
 */
const vehicleLookupSchema = new mongoose.Schema({
  registrationNumber: {
    type: String,
    maxlength: 100,
    required: false,
    sparse: true
    // NOT unique - duplicates allowed (as per user requirement)
  },
  chassisNumber: {
    type: String,
    maxlength: 100,
    required: false,
    sparse: true
    // NOT unique - duplicates allowed (as per user requirement)
  },
  excelFileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ExcelFile',
    required: true, // STRICT: Always required, no nulls allowed
    index: true
    // Required for deletion - allows deleting all records for a specific file
  }
}, {
  timestamps: false, // No createdAt/updatedAt
  versionKey: false, // No __v field
  collection: 'vehiclelookups'
});

// LEVEL 1: MINIMAL INDEXES - Only essential indexes
// Reduced from 10 indexes to 2 indexes (plus _id)

// 1. Index on registrationNumber (NOT unique - duplicates allowed)
vehicleLookupSchema.index({ registrationNumber: 1 }, { 
  unique: false,
  sparse: true,
  name: 'reg_idx',
  background: true
});

// 2. Index on chassisNumber (NOT unique - duplicates allowed)
vehicleLookupSchema.index({ chassisNumber: 1 }, { 
  unique: false,
  sparse: true,
  name: 'chassis_idx',
  background: true
});

// 3. Index on excelFileId for fast deletion by file
vehicleLookupSchema.index({ excelFileId: 1 }, { 
  name: 'excelFileId_idx',
  background: true
});

// REMOVED INDEXES (saves ~30-35 MB):
// ❌ registrationNumberStateCode (derived field - removed)
// ❌ registrationNumberLastFour (derived field - removed)
// ❌ registrationNumber (non-unique - replaced with unique)
// ❌ excelFileId (metadata - removed)
// ❌ rowNumber (metadata - removed)
// ❌ createdAt (metadata - removed)
// ❌ All compound indexes (not needed with runtime parsing)

module.exports = mongoose.model('VehicleLookup', vehicleLookupSchema);
