const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const XLSX = require('xlsx');
const { body, validationResult, query } = require('express-validator');
const ExcelFile = require('../models/ExcelFile');
// ✅ PRODUCTION: ExcelVehicle removed - use VehicleLookup + GCS only
// const ExcelVehicle = require('../models/ExcelVehicle'); // DEPRECATED - removed from production
const VehicleLookup = require('../models/VehicleLookup');
const User = require('../models/User');
const FileStorageSettings = require('../models/FileStorageSettings');
const UserStorageLimit = require('../models/UserStorageLimit');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { uploadFileToGCS, deleteFileFromGCS, getFileBufferFromGCS, isGCSConfigured } = require('../services/gcsService');
const { getVehicleDataFromExcel, getMultipleVehicleDataFromExcel, searchVehiclesInExcel, clearCacheForFile, preCacheExcelFiles, getCacheDetails } = require('../services/excelCacheService');
const { parseRegistrationNumber, buildStateCodeSearchQuery, INDIAN_STATE_CODES } = require('../utils/registrationNumberParser');

const router = express.Router();

// Check GCS configuration
if (!isGCSConfigured()) {
  console.warn('⚠️  WARNING: GCS is not configured. Excel uploads will use local storage.');
  console.warn('⚠️  Please set GCS_PROJECT_ID, GCS_BUCKET_NAME, and GCS credentials for optimized storage.');
}

// Configure multer for temporary file storage (will be uploaded to GCS)
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/excel/temp');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'excel-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  // Check file type
  if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel') {
    cb(null, true);
  } else {
    cb(new Error('Only Excel files (.xlsx, .xls) are allowed'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 1
  }
});

// Expected Excel headers
const EXPECTED_HEADERS = [
  'registration_number',
  'first_confirmer_name',
  'first_confirmer_no',
  'second_confirmer_name',
  'second_confirmer_no',
  'third_confirmer_name',
  'third_confirmer_no',
  'loan_number',
  'make',
  'chasis_number',
  'engine_number',
  'emi',
  'pos',
  'bucket',
  'customer_name',
  'address',
  'branch',
  'sec_17',
  'seasoning',
  'tbr',
  'allocation',
  'model',
  'product_name'
];

// @desc    Upload Excel file
// @route   POST /api/excel/upload
// @access  Private (SuperSuperAdmin, SuperAdmin, Admin)
router.post('/upload', 
  authenticateToken, 
  authorizeRole('superSuperAdmin', 'superAdmin', 'admin'),
  upload.single('excelFile'),
  [
    body('assignedTo').optional().custom((value, { req }) => {
      // SuperSuperAdmin and SuperAdmin must assign to at least one admin
      if ((req.user.role === 'superSuperAdmin' || req.user.role === 'superAdmin') && !value) {
        throw new Error('Admin assignment is required for super admin uploads');
      }
      return true;
    }),
    body('assignedAdmins').optional().custom((value, { req }) => {
      if (value) {
        // Handle both string and array formats
        if (typeof value === 'string') {
          try {
            const parsed = JSON.parse(value);
            if (!Array.isArray(parsed)) {
              throw new Error('assignedAdmins must be an array');
            }
          } catch (error) {
            throw new Error('assignedAdmins must be a valid JSON array');
          }
        } else if (!Array.isArray(value)) {
          throw new Error('assignedAdmins must be an array');
        }
      }
      return true;
    })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: errors.array()
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No file uploaded'
        });
      }

      // Determine assigned admins
      let assignedTo = req.user._id;
      let assignedAdmins = [req.user._id];
      let sharedAdmins = []; // Admin-to-admin file sharing
      
      if (req.user.role === 'superSuperAdmin' || req.user.role === 'superAdmin') {
        if (!req.body.assignedTo) {
          return res.status(400).json({
            success: false,
            message: 'Admin assignment is required for super admin uploads'
          });
        }
        
        // Handle multiple admin assignments
        let adminIds = [req.body.assignedTo];
        
        if (req.body.assignedAdmins) {
          try {
            // Parse JSON string if it's sent as string
            const assignedAdmins = typeof req.body.assignedAdmins === 'string' 
              ? JSON.parse(req.body.assignedAdmins) 
              : req.body.assignedAdmins;
            
            if (Array.isArray(assignedAdmins)) {
              adminIds = assignedAdmins;
            }
          } catch (error) {
            console.error('Error parsing assignedAdmins:', error);
            adminIds = [req.body.assignedTo];
          }
        }
        
        // Verify all assigned admins exist and are active
        const assignedAdminUsers = await User.find({
          _id: { $in: adminIds },
          role: 'admin',
          isActive: true
        });
        
        if (assignedAdminUsers.length !== adminIds.length) {
          return res.status(400).json({
            success: false,
            message: 'One or more assigned admins are invalid or inactive'
          });
        }
        
        assignedTo = req.body.assignedTo; // Primary admin (first in the list)
        assignedAdmins = adminIds;
      } else if (req.user.role === 'admin') {
        // Admin uploading their own file - check if they want to share with other admins
        if (req.body.sharedAdmins) {
          // Check if admin has sharing permission
          const currentUser = await User.findById(req.user._id).select('canShareFiles');
          if (!currentUser.canShareFiles) {
            return res.status(403).json({
              success: false,
              message: 'You do not have permission to share files with other admins. Please request permission from super admin.'
            });
          }

          // Parse sharedAdmins if it's a string
          let sharedAdminIds = [];
          try {
            sharedAdminIds = typeof req.body.sharedAdmins === 'string' 
              ? JSON.parse(req.body.sharedAdmins) 
              : req.body.sharedAdmins;
            
            if (!Array.isArray(sharedAdminIds)) {
              return res.status(400).json({
                success: false,
                message: 'sharedAdmins must be an array'
              });
            }

            // Remove self from shared admins (admin is already the primary admin)
            sharedAdminIds = sharedAdminIds.filter(id => id.toString() !== req.user._id.toString());

            if (sharedAdminIds.length > 0) {
              // Verify all shared admins exist and are active
              const sharedAdminUsers = await User.find({
                _id: { $in: sharedAdminIds },
                role: 'admin',
                isActive: true
              });
              
              if (sharedAdminUsers.length !== sharedAdminIds.length) {
                return res.status(400).json({
                  success: false,
                  message: 'One or more shared admins are invalid or inactive'
                });
              }

              sharedAdmins = sharedAdminIds;
            }
          } catch (error) {
            console.error('Error parsing sharedAdmins:', error);
            return res.status(400).json({
              success: false,
              message: 'Invalid sharedAdmins format'
            });
          }
        }
      }

      // Read Excel file with streaming approach
      const workbook = XLSX.readFile(req.file.path, { 
        cellDates: true,
        cellNF: false,
        cellText: false,
        cellStyles: false
      });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      // Get the range of data
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
      const totalRows = range.e.r + 1; // +1 because range is 0-based
      
      if (totalRows < 2) {
        return res.status(400).json({
          success: false,
          message: 'Excel file must contain at least headers and one data row'
        });
      }

      // Read headers first
      const headers = [];
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
        const cell = worksheet[cellAddress];
        headers[col] = cell ? cell.v : null;
      }

      // Validate headers
      const missingHeaders = EXPECTED_HEADERS.filter(header => !headers.includes(header));
      
      if (missingHeaders.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid Excel headers',
          missingHeaders: missingHeaders,
          expectedHeaders: EXPECTED_HEADERS
        });
      }

      // Check storage limit - Individual limit takes priority over role limit
      const recordCount = totalRows - 1; // Exclude header row
      const userRole = req.user.role;
      
      // First, check if user has individual custom limit
      let userStorageLimit = await UserStorageLimit.findOne({ 
        userId: req.user._id, 
        isActive: true 
      });

      let totalRecordLimit;
      let limitType = 'role'; // 'individual' or 'role'

      if (userStorageLimit) {
        // User has custom individual limit
        totalRecordLimit = userStorageLimit.totalRecordLimit;
        limitType = 'individual';
      } else {
        // Fall back to role-based limit
        const storageSettings = await FileStorageSettings.findOne({ 
          role: userRole, 
          isActive: true 
        });

        if (!storageSettings) {
          return res.status(400).json({
            success: false,
            message: 'File storage settings not found for your role. Please contact administrator.'
          });
        }

        totalRecordLimit = storageSettings.totalRecordLimit;
        limitType = 'role';
      }

      // Calculate current usage for this user
      const currentUsage = await ExcelFile.aggregate([
        {
          $match: {
            uploadedBy: req.user._id,
            status: { $in: ['completed', 'partial'] }
          }
        },
        {
          $group: {
            _id: null,
            totalRecords: { $sum: '$totalRows' }
          }
        }
      ]);

      const usedRecords = currentUsage.length > 0 ? currentUsage[0].totalRecords : 0;
      const remainingRecords = Math.max(0, totalRecordLimit - usedRecords);

      if (recordCount > remainingRecords) {
        const limitTypeText = limitType === 'individual' ? 'individual' : `role (${userRole})`;
        return res.status(400).json({
          success: false,
          message: `Total record limit exceeded. Your ${limitTypeText} limit is ${totalRecordLimit.toLocaleString()} records. You have used ${usedRecords.toLocaleString()} records and can upload maximum ${remainingRecords.toLocaleString()} more records. File contains ${recordCount.toLocaleString()} records.`,
          totalLimit: totalRecordLimit,
          usedRecords: usedRecords,
          remainingRecords: remainingRecords,
          fileRecords: recordCount,
          limitType: limitType
        });
      }

      // OPTIMIZED STORAGE: Upload file to GCS if configured, otherwise use local storage
      let gcsFileUrl = null;
      if (isGCSConfigured()) {
        try {
          const gcsFileName = `excel/${Date.now()}-${req.file.filename}`;
          gcsFileUrl = await uploadFileToGCS(req.file.path, gcsFileName);
          console.log(`✅ File uploaded to GCS: ${gcsFileUrl.substring(0, 80)}...`);
        } catch (gcsError) {
          console.error('❌ GCS upload failed, falling back to local storage:', gcsError.message);
          // Continue with local storage
        }
      }

      // Create ExcelFile record (store GCS URL if available, otherwise local path)
      const excelFile = await ExcelFile.create({
        filename: req.file.filename,
        originalName: req.file.originalname,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        uploadedBy: req.user._id,
        assignedTo: assignedTo,
        assignedAdmins: assignedAdmins,
        sharedAdmins: sharedAdmins, // Admin-to-admin file sharing
        totalRows: recordCount,
        filePath: gcsFileUrl || req.file.path // Store GCS URL if available
      });

      // OPTIMIZED STORAGE: Extract ONLY registrationNumber and chassisNumber to MongoDB
      // All other data remains in GCS Excel file (or local file if GCS not configured)
      const chunkSize = 1000;
      let processedRows = 0;
      let failedRows = 0;
      let skippedRows = 0;

      // Find column indices for registration_number and chasis_number
      const regColIndex = headers.indexOf('registration_number');
      const chassisColIndex = headers.indexOf('chasis_number');

      // Process rows in chunks
      for (let startRow = 1; startRow < totalRows; startRow += chunkSize) {
        const endRow = Math.min(startRow + chunkSize - 1, totalRows - 1);
        const bulkOps = [];
        
        for (let row = startRow; row <= endRow; row++) {
          const rowNumber = row + 1; // +1 because we start from row 2 (after header)
          
          // Get registration_number and chasis_number cells
          const regCellAddress = XLSX.utils.encode_cell({ r: row, c: regColIndex });
          const chassisCellAddress = XLSX.utils.encode_cell({ r: row, c: chassisColIndex });
          const regCell = worksheet[regCellAddress];
          const chassisCell = worksheet[chassisCellAddress];
          
          const registrationNumber = regCell ? regCell.v?.toString().trim() : null;
          const chassisNumber = chassisCell ? chassisCell.v?.toString().trim() : null;

          // Skip if both are empty
          if (!registrationNumber && !chassisNumber) {
            skippedRows++;
            continue;
          }

          // Store registrationNumber and chassisNumber in MongoDB (VehicleLookup)
          // Other data stored in GCS (Excel file)
          if (gcsFileUrl) {
            // Store search keys in VehicleLookup with file reference for easy deletion
            bulkOps.push({
              insertOne: {
                document: {
                  registrationNumber: registrationNumber || null,
                  chassisNumber: chassisNumber || null,
                  excelFileId: excelFile._id // Required for deletion by file
                }
              }
            });
          } else {
            // ✅ PRODUCTION: GCS is REQUIRED - no ExcelVehicle writes
            // Store registration/chassis in VehicleLookup only (full data in GCS)
            bulkOps.push({
              insertOne: {
                document: {
                  registrationNumber: registrationNumber || null,
                  chassisNumber: chassisNumber || null,
                  excelFileId: excelFile._id
                }
              }
            });
          }
        }

        // Execute bulk operations
        // ✅ PRODUCTION: Only VehicleLookup writes (full data stored in GCS)
        if (bulkOps.length > 0) {
          try {
            // ✅ PRODUCTION: GCS is REQUIRED - no fallback to ExcelVehicle
            if (!gcsFileUrl) {
              throw new Error('GCS configuration required. Please configure GCS_PROJECT_ID, GCS_BUCKET_NAME, and GCS credentials.');
            }
            
            // All bulkOps are VehicleLookup operations (excelFileId present)
            const vehicleLookupOps = bulkOps.filter(op => op.insertOne.document.excelFileId);
            if (vehicleLookupOps.length > 0) {
              const result = await VehicleLookup.bulkWrite(vehicleLookupOps, { 
                ordered: false, // Continue on errors
                w: 1
              });
              processedRows += result.insertedCount;
              
              // Handle any write errors (should be rare now that we allow duplicates)
              if (result.writeErrors && result.writeErrors.length > 0) {
                // Log only non-duplicate errors (duplicates are now allowed, so 11000 shouldn't occur)
                const nonDuplicateErrors = result.writeErrors.filter(err => err.code !== 11000);
                failedRows += nonDuplicateErrors.length;
                if (nonDuplicateErrors.length > 0) {
                  console.log(`⚠️  Chunk ${Math.floor(startRow / chunkSize) + 1}: ${nonDuplicateErrors.length} entries failed to insert`);
                }
              }
            }
          } catch (error) {
            // Only log unexpected errors (not duplicate key errors since duplicates are now allowed)
            if (error.code !== 11000) {
              console.error(`Chunk ${Math.floor(startRow / chunkSize) + 1} error:`, error.message);
            }
            failedRows += bulkOps.length;
          }
        }

        // Update progress every 5 chunks
        if ((Math.floor(startRow / chunkSize) + 1) % 5 === 0 || endRow >= totalRows - 1) {
          await ExcelFile.findByIdAndUpdate(excelFile._id, {
            processedRows: processedRows,
            failedRows: failedRows,
            skippedRows: skippedRows,
            status: 'processing'
          });
        }

        // Force garbage collection every 10 chunks to free memory
        if ((Math.floor(startRow / chunkSize) + 1) % 10 === 0) {
          if (global.gc) {
            global.gc();
          }
        }
      }

      // Update ExcelFile with final results
      const status = failedRows === 0 ? 'completed' : 
                    processedRows === 0 ? 'failed' : 'partial';
      
      await ExcelFile.findByIdAndUpdate(excelFile._id, {
        processedRows,
        failedRows,
        skippedRows,
        status,
        errorMessage: failedRows > 0 ? `Failed to process ${failedRows} rows` : null
      });

      // Delete temporary local file if uploaded to GCS
      if (gcsFileUrl && req.file) {
        try {
          await fs.unlink(req.file.path);
          console.log(`✅ Deleted temporary local file: ${req.file.path}`);
        } catch (unlinkError) {
          console.error('Error deleting temp file:', unlinkError);
        }
      }

      // Clear search cache after new data upload
      clearSearchCache();
      clearUserCache(req.user._id.toString());
      // Clear cache for all assigned admins
      if (assignedAdmins && assignedAdmins.length > 0) {
        assignedAdmins.forEach(adminId => {
          clearUserCache(adminId.toString());
        });
      }

      res.status(201).json({
        success: true,
        message: gcsFileUrl ? 'Excel file uploaded to GCS and processed successfully' : 'Excel file uploaded and processed successfully',
        data: {
          fileId: excelFile._id,
          filename: req.file.originalname,
          totalRows: recordCount,
          processedRows,
          failedRows,
          skippedRows,
          status,
          storageType: gcsFileUrl ? 'GCS' : 'local',
          gcsFileUrl: gcsFileUrl || undefined
        }
      });

    } catch (error) {
      console.error('Excel upload error:', error);
      
      // Clean up uploaded file if error occurs
      if (req.file) {
        try {
          await fs.unlink(req.file.path);
        } catch (unlinkError) {
          console.error('Error deleting file:', unlinkError);
        }
      }

      // Handle MongoDB quota errors
      if (error.message && error.message.includes('space quota')) {
        return res.status(507).json({
          success: false,
          message: 'MongoDB storage quota exceeded. Please contact administrator to upgrade storage plan.',
          error: 'STORAGE_QUOTA_EXCEEDED'
        });
      }

      res.status(500).json({
        success: false,
        message: 'Server error during file upload',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// ============================================================================
// FILENAME VISIBILITY HELPER FUNCTIONS (SINGLE SOURCE OF TRUTH)
// ============================================================================

/**
 * Determines if a user can see the real (unmasked) Excel filename
 * 
 * RULES:
 * - SuperAdmin/SuperSuperAdmin: Always see real filename
 * - Primary Admin: See real filename
 *   - For SuperAdmin uploads: Primary admin = assignedTo
 *   - For Admin uploads: Primary admin = uploadedBy (the uploader)
 * - Primary Admin's Auditor: See real filename (auditor's admin === primary admin)
 * - Everyone else: See masked filename
 * 
 * @param {Object} params
 * @param {Object} params.user - Current user object (req.user)
 * @param {Object} params.file - ExcelFile object with assignedTo, uploadedBy, etc.
 * @param {Object} params.userAdmin - Admin object if user is auditor/fieldAgent (null otherwise)
 * @returns {boolean} - true if user can see real filename, false otherwise
 */
const canSeeRealFilename = ({ user, file, userAdmin }) => {
  const userRole = user.role;
  const userId = user._id.toString();
  
  // SuperAdmin/SuperSuperAdmin always see real filename
  if (userRole === 'superSuperAdmin' || userRole === 'superAdmin') {
    return true;
  }
  
  // Determine primary admin ID based on upload type
  const uploaderRole = file.uploadedBy?.role || file.uploaderRole;
  const isSuperAdminUpload = uploaderRole === 'superAdmin' || uploaderRole === 'superSuperAdmin';
  const isAdminUpload = uploaderRole === 'admin';
  
  let primaryAdminId = null;
  
  if (isSuperAdminUpload) {
    // For SuperAdmin uploads: Primary admin = assignedTo
    primaryAdminId = file.assignedTo?._id?.toString() || file.assignedTo?.toString() || null;
  } else if (isAdminUpload) {
    // For Admin uploads: Primary admin = uploadedBy (the uploader)
    primaryAdminId = file.uploadedBy?._id?.toString() || file.uploadedBy?.toString() || null;
  }
  
  // If no primary admin identified, no one can see real filename (except SuperAdmin above)
  if (!primaryAdminId) {
    return false;
  }
  
  // Primary Admin can see real filename
  if (userRole === 'admin' && userId === primaryAdminId) {
    return true;
  }
  
  // Primary Admin's Auditor can see real filename
  if (userRole === 'auditor' && userAdmin) {
    const userAdminId = userAdmin._id?.toString() || userAdmin.toString();
    if (userAdminId === primaryAdminId) {
      return true;
    }
  }
  
  // Everyone else sees masked filename
  return false;
};

/**
 * Generates a masked filename from the original name
 * Format: FILE_<8_CHAR_HASH>.xlsx
 * 
 * @param {string} originalName - Original filename
 * @returns {string} - Masked filename
 */
const generateMaskedFilename = (originalName) => {
  const hash = require('crypto').createHash('md5').update(originalName).digest('hex').substring(0, 8);
  const extension = originalName.split('.').pop();
  return `FILE_${hash.toUpperCase()}.${extension}`;
};

/**
 * Returns the Excel file object with appropriate filename visibility
 * 
 * @param {Object} params
 * @param {Object} params.user - Current user object (req.user)
 * @param {Object} params.file - ExcelFile object
 * @param {Object} params.userAdmin - Admin object if user is auditor/fieldAgent (null otherwise)
 * @returns {Object} - Excel file object with masked/unmasked filename
 */
const getExcelFileWithVisibility = ({ user, file, userAdmin }) => {
  const canSeeReal = canSeeRealFilename({ user, file, userAdmin });
  
  if (canSeeReal) {
    // Return original filename
    return {
      ...file,
      originalName: file.originalName,
      filename: file.filename
    };
  } else {
    // Return masked filename
    return {
      ...file,
      originalName: generateMaskedFilename(file.originalName),
      filename: `FILE_${file._id.toString().substring(0, 8).toUpperCase()}.xlsx`
    };
  }
};

// Legacy function kept for backward compatibility (deprecated - use getExcelFileWithVisibility instead)
const maskFilename = (originalName, uploadedByRole, currentUserRole) => {
  // This function is deprecated but kept for any edge cases
  // New code should use getExcelFileWithVisibility instead
  return generateMaskedFilename(originalName);
};

// ============================================================================
// SEARCH PRIORITY HELPER FUNCTION
// ============================================================================

/**
 * Determines search priority for a vehicle to prioritize "own data" first
 * 
 * RULES:
 * - Admin: "own data" = primary admin (assignedTo for SuperAdmin uploads, uploadedBy for Admin uploads) === user._id
 * - Auditor / FieldAgent: "own data" = primary admin === userAdmin._id
 * 
 * PRIMARY ADMIN DETERMINATION:
 * - SuperAdmin uploads: Primary admin = assignedTo
 * - Admin uploads: Primary admin = uploadedBy (the uploader)
 * 
 * @param {Object} params
 * @param {Object} params.vehicle - Vehicle object with excel_file property
 * @param {Object} params.user - Current user object (req.user)
 * @param {Object} params.userAdmin - Admin object if user is auditor/fieldAgent (null otherwise)
 * @returns {number} - 0 for own data (higher priority), 1 for others (lower priority)
 */
const getSearchPriority = ({ vehicle, user, userAdmin }) => {
  const userRole = user.role;
  const excelFile = vehicle.excel_file;
  
  if (!excelFile) {
    return 1; // No file = not own data
  }
  
  // Determine uploader role to identify upload type
  const uploaderRole = vehicle.uploaderRole || excelFile.uploadedBy?.role;
  const isSuperAdminUpload = uploaderRole === 'superAdmin' || uploaderRole === 'superSuperAdmin';
  const isAdminUpload = uploaderRole === 'admin';
  
  // Helper function to extract ID from various formats (ObjectId, object with _id, string)
  const extractId = (value) => {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (value._id) return value._id.toString();
    if (value.toString) return value.toString();
    return null;
  };
  
  // Determine primary admin ID based on upload type
  let primaryAdminId = null;
  
  if (isSuperAdminUpload) {
    // For SuperAdmin uploads: Primary admin = assignedTo
    primaryAdminId = extractId(excelFile.assignedTo);
  } else if (isAdminUpload) {
    // For Admin uploads: Primary admin = uploadedBy (the uploader)
    primaryAdminId = extractId(excelFile.uploadedBy);
  } else {
    // Unknown upload type or no uploader role = not own data
    return 1;
  }
  
  // If no primary admin identified, not own data
  if (!primaryAdminId) {
    return 1;
  }
  
  // Determine if this is "own data" based on user role
  if (userRole === 'admin') {
    // Admin: own data = primary admin === user._id
    const userId = user._id.toString();
    return primaryAdminId === userId ? 0 : 1;
  } else if (userRole === 'auditor' || userRole === 'fieldAgent') {
    // Auditor/FieldAgent: own data = primary admin === userAdmin._id
    if (!userAdmin) {
      return 1; // No admin = not own data
    }
    const userAdminId = userAdmin._id?.toString() || userAdmin.toString();
    return primaryAdminId === userAdminId ? 0 : 1;
  }
  
  // SuperAdmin/SuperSuperAdmin: all data is equal priority
  return 1;
};

// @desc    Get all Excel files (with role-based access)
// @route   GET /api/excel/files
// @access  Private (SuperAdmin, Admin)
router.get('/files',
  authenticateToken,
  authorizeRole('superSuperAdmin', 'superAdmin', 'admin'),
  async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = Math.min(parseInt(req.query.limit) || 10, 100);
      const { status, search } = req.query;

      // Build aggregation pipeline
      const pipeline = [
        // Match stage for initial filtering
        {
          $match: {
            isActive: true,
            ...(status && { status }),
            ...(req.user.role === 'admin' && {
              // Admin can only see:
              // 1. Files they uploaded (owner)
              // 2. Files assigned to them (from SuperAdmin uploads only)
              // 3. Files shared with them by other admins
              $or: [
                { uploadedBy: req.user._id }, // Files they own
                // Only show assigned files if uploaded by SuperAdmin (not by other admins)
                {
                  $and: [
                    { assignedTo: req.user._id },
                    { uploadedBy: { $exists: true } } // Will be filtered by lookup to check uploader role
                  ]
                },
                {
                  $and: [
                    { assignedAdmins: req.user._id },
                    { uploadedBy: { $exists: true } } // Will be filtered by lookup to check uploader role
                  ]
                },
                { sharedAdmins: req.user._id } // Files shared with them by other admins
              ]
            })
          }
        },

        // Search stage if search term provided
        ...(search ? [{
          $match: {
            $or: [
              { originalName: new RegExp(search, 'i') },
              { filename: new RegExp(search, 'i') }
            ]
          }
        }] : []),

        // Lookup uploadedBy user details
        {
          $lookup: {
            from: 'users',
            localField: 'uploadedBy',
            foreignField: '_id',
            as: 'uploadedByUser',
            pipeline: [
              {
                $project: {
                  name: 1,
                  email: 1,
                  role: 1
                }
              }
            ]
          }
        },

        // Lookup assignedTo user details
        {
          $lookup: {
            from: 'users',
            localField: 'assignedTo',
            foreignField: '_id',
            as: 'assignedToUser',
            pipeline: [
              {
                $project: {
                  name: 1,
                  email: 1
                }
              }
            ]
          }
        },

        // Lookup assignedAdmins user details
        {
          $lookup: {
            from: 'users',
            localField: 'assignedAdmins',
            foreignField: '_id',
            as: 'assignedAdminsUsers',
            pipeline: [
              {
                $project: {
                  name: 1,
                  email: 1
                }
              }
            ]
          }
        },

        // Lookup sharedAdmins user details (admin-to-admin file sharing)
        {
          $lookup: {
            from: 'users',
            localField: 'sharedAdmins',
            foreignField: '_id',
            as: 'sharedAdminsUsers',
            pipeline: [
              {
                $project: {
                  name: 1,
                  email: 1
                }
              }
            ]
          }
        },

        // Unwind the lookups
        {
          $unwind: {
            path: '$uploadedByUser',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $unwind: {
            path: '$assignedToUser',
            preserveNullAndEmptyArrays: true
          }
        },

        // Filter: If admin viewing, exclude admin-uploaded files unless they own them or are shared with them
        ...(req.user.role === 'admin' ? [{
          $match: {
            $or: [
              { 'uploadedByUser.role': { $in: ['superSuperAdmin', 'superAdmin'] } }, // SuperAdmin uploads
              { uploadedBy: req.user._id }, // Or files they own
              { sharedAdmins: req.user._id } // Or files shared with them
            ]
          }
        }] : []),

        // Project stage to reshape the output
        {
          $project: {
            _id: 1,
            filename: 1,
            originalName: 1,
            fileSize: 1,
            mimeType: 1,
            totalRows: 1,
            processedRows: 1,
            failedRows: 1,
            skippedRows: 1,
            status: 1,
            errorMessage: 1,
            filePath: 1,
            createdAt: 1,
            updatedAt: 1,
            uploadedBy: {
              _id: '$uploadedByUser._id',
              name: '$uploadedByUser.name',
              email: '$uploadedByUser.email',
              role: '$uploadedByUser.role'
            },
            assignedTo: {
              _id: '$assignedToUser._id',
              name: '$assignedToUser.name',
              email: '$assignedToUser.email'
            },
            assignedAdmins: '$assignedAdminsUsers',
            sharedAdmins: '$sharedAdminsUsers' // Admin-to-admin file sharing
          }
        },

        // Sort by createdAt descending
        {
          $sort: { createdAt: -1 }
        }
      ];

      // Add facet stage for pagination
      const facetedPipeline = [
        ...pipeline,
        {
          $facet: {
            metadata: [{ $count: 'total' }],
            data: [
              { $skip: (page - 1) * limit },
              { $limit: limit }
            ]
          }
        }
      ];

      // Execute aggregation with optimized pipeline
      const [result] = await ExcelFile.aggregate(facetedPipeline);
      const files = result.data;
      const total = result.metadata[0]?.total || 0;

      // Get user's admin if current user is auditor (for checking primary vs assigned admin)
      let userAdmin = null;
      if (req.user.role === 'auditor' && req.user.createdBy) {
        userAdmin = await User.findById(req.user.createdBy).select('_id').lean();
      }

      // Apply filename visibility rules using centralized helper
      const maskedFiles = files.map(file => {
        const fileWithVisibility = getExcelFileWithVisibility({
          user: req.user,
          file: file,
          userAdmin: userAdmin
        });
        
        // ============================================================
        // 🛡️ HIDE ASSIGNED ADMINS FROM NON-PRIMARY ADMINS
        // ============================================================
        // Only show assignedAdmins (excluding primary) to the primary admin
        const primaryAdminId = file.assignedTo?._id?.toString() || file.assignedTo?.toString();
        const currentUserId = req.user._id.toString();
        const isPrimaryAdmin = primaryAdminId === currentUserId;
        
        // For auditors, check if their admin is the primary admin
        let isPrimaryAdminAuditor = false;
        if (req.user.role === 'auditor' && userAdmin) {
          isPrimaryAdminAuditor = userAdmin._id.toString() === primaryAdminId;
        }
        
        // Hide assignedAdmins from non-primary admins (except superSuperAdmin/superAdmin who can see everything)
        if (!isPrimaryAdmin && !isPrimaryAdminAuditor && 
            req.user.role !== 'superSuperAdmin' && req.user.role !== 'superAdmin') {
          // Remove assignedAdmins (excluding primary) from response
          // Keep only the primary admin in assignedAdmins
          if (fileWithVisibility.assignedAdmins && fileWithVisibility.assignedAdmins.length > 0) {
            fileWithVisibility.assignedAdmins = fileWithVisibility.assignedAdmins.filter((admin) => {
              const adminId = typeof admin === 'object' ? admin._id?.toString() : admin.toString();
              return adminId === primaryAdminId;
            });
          }
        }
        
        return fileWithVisibility;
      });

      res.json({
        success: true,
        data: maskedFiles,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });

    } catch (error) {
      console.error('Get Excel files error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }
  }
);

// @desc    Get Excel file by ID
// @route   GET /api/excel/files/:id
// @access  Private (SuperAdmin, Admin)
router.get('/files/:id',
  authenticateToken,
  authorizeRole('superSuperAdmin', 'superAdmin', 'admin'),
  async (req, res) => {
    try {
      const excelFile = await ExcelFile.findById(req.params.id)
        .populate('uploadedBy', 'name email')
        .populate('assignedTo', 'name email');

      if (!excelFile) {
        return res.status(404).json({
          success: false,
          message: 'Excel file not found'
        });
      }

      // Check access permissions
      if (req.user.role === 'admin') {
        const isOwner = excelFile.uploadedBy._id.toString() === req.user._id.toString();
        const isAssigned = excelFile.assignedTo && excelFile.assignedTo._id.toString() === req.user._id.toString();
        const isShared = excelFile.sharedAdmins && excelFile.sharedAdmins.some(adminId => adminId.toString() === req.user._id.toString());
        
        if (!isOwner && !isAssigned && !isShared) {
          return res.status(403).json({
            success: false,
            message: 'Access denied'
          });
        }
      }

      // Get userAdmin for auditors/fieldAgents
      let userAdmin = null;
      if ((req.user.role === 'auditor' || req.user.role === 'fieldAgent') && req.user.createdBy) {
        userAdmin = await User.findById(req.user.createdBy).select('_id').lean();
      }

      // Apply filename visibility using centralized helper
      const fileWithVisibility = getExcelFileWithVisibility({
        user: req.user,
        file: excelFile,
        userAdmin: userAdmin
      });

      res.json({
        success: true,
        data: fileWithVisibility
      });

    } catch (error) {
      console.error('Get Excel file error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }
  }
);

// @desc    Delete Excel file and all related vehicle data
// @route   DELETE /api/excel/files/:id
// @access  Private (SuperAdmin, Admin)
router.delete('/files/:id',
  authenticateToken,
  authorizeRole('superSuperAdmin', 'superAdmin', 'admin'),
  async (req, res) => {
    try {
      const fileId = req.params.id;
      const excelFile = await ExcelFile.findById(fileId);

      if (!excelFile) {
        return res.json({
          success: true,
          message: 'File already deleted'
        });
      }

      // Check access permissions
      if (req.user.role === 'admin' && 
          excelFile.uploadedBy.toString() !== req.user._id.toString() &&
          excelFile.assignedTo.toString() !== req.user._id.toString() &&
          !excelFile.sharedAdmins?.some(id => id.toString() === req.user._id.toString())) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      /* 1️⃣ DELETE Mongo lookup data (MOST IMPORTANT) */
      const lookupResult = await VehicleLookup.deleteMany({
        excelFileId: excelFile._id
      });
      console.log(`🗑️ Deleted ${lookupResult.deletedCount || 0} VehicleLookup records for file ${excelFile._id}`);

      /* 2️⃣ DELETE VehicleLookup records (ExcelVehicle removed - no longer used) */

      /* 3️⃣ DELETE ExcelFile record (SOURCE OF TRUTH) */
      const excelFileDeleteResult = await ExcelFile.findByIdAndDelete(excelFile._id);
      
      if (!excelFileDeleteResult) {
        console.error(`❌ Failed to delete ExcelFile record with ID: ${excelFile._id}`);
        return res.status(500).json({
          success: false,
          message: 'Failed to delete Excel file record from database'
        });
      }
      console.log(`✅ Deleted ExcelFile record: ${excelFile._id}`);

      /* 4️⃣ DELETE GCS FILE (BEST-EFFORT, NEVER BLOCK) */
      if (excelFile.filePath && excelFile.filePath.includes('storage.googleapis.com')) {
        try {
          await deleteFileFromGCS(excelFile.filePath);
          console.log('✅ GCS file deleted');
          // Clear Excel cache for this file
          clearCacheForFile(excelFile.filePath);
        } catch (err) {
          if (err.code === 404) {
            console.warn('⚠️ GCS file already missing, skipping');
          } else {
            console.error('❌ GCS delete failed:', err.message);
          }
          // ❗ NEVER THROW - Continue execution
        }
      } else if (excelFile.filePath) {
        // Delete local file (best-effort)
        try {
          await fs.unlink(excelFile.filePath);
          console.log(`✅ Deleted local file: ${excelFile.filePath}`);
        } catch (err) {
          if (err.code === 'ENOENT') {
            console.warn('⚠️ Local file already missing, skipping');
          } else {
            console.error('❌ Local file delete failed:', err.message);
          }
          // ❗ NEVER THROW - Continue execution
        }
      }

      /* 5️⃣ CLEAR MEMORY CACHE */
      clearSearchCache();
      clearUserCache(excelFile.uploadedBy.toString());
      // Clear cache for all assigned admins
      if (excelFile.assignedAdmins && excelFile.assignedAdmins.length > 0) {
        excelFile.assignedAdmins.forEach(adminId => {
          clearUserCache(adminId.toString());
        });
      }

      res.json({
        success: true,
        message: 'Excel file deleted successfully',
        deleted: {
          vehicleLookup: lookupResult.deletedCount || 0,
          excelFile: 1
        }
      });

    } catch (error) {
      console.error('Delete Excel file error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }
  }
);

// @desc    Update shared admins for Excel file (Admin only - for files they uploaded)
// @route   PUT /api/excel/files/:id/update-shared-admins
// @access  Private (admin)
router.put('/files/:id/update-shared-admins',
  authenticateToken,
  authorizeRole('admin'),
  [
    body('sharedAdmins').custom((value, { req }) => {
      if (value === undefined || value === null) {
        throw new Error('sharedAdmins is required');
      }
      
      // Handle both string and array formats
      let adminArray;
      if (typeof value === 'string') {
        try {
          adminArray = JSON.parse(value);
        } catch (error) {
          throw new Error('sharedAdmins must be a valid JSON array');
        }
      } else {
        adminArray = value;
      }
      
      if (!Array.isArray(adminArray)) {
        throw new Error('sharedAdmins must be an array');
      }
      
      // Validate each admin ID
      const mongoIdRegex = /^[0-9a-fA-F]{24}$/;
      for (let i = 0; i < adminArray.length; i++) {
        if (!mongoIdRegex.test(adminArray[i])) {
          throw new Error(`sharedAdmins[${i}] must be a valid MongoDB ID`);
        }
      }
      
      return true;
    })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: errors.array()
        });
      }

      const fileId = req.params.id;
      const { sharedAdmins } = req.body;

      // Parse sharedAdmins if it's a string
      let sharedAdminIds = [];
      try {
        sharedAdminIds = typeof sharedAdmins === 'string' 
          ? JSON.parse(sharedAdmins) 
          : sharedAdmins;
        
        if (!Array.isArray(sharedAdminIds)) {
          return res.status(400).json({
            success: false,
            message: 'sharedAdmins must be an array'
          });
        }
      } catch (error) {
        console.error('Error parsing sharedAdmins:', error);
        return res.status(400).json({
          success: false,
          message: 'Invalid sharedAdmins format'
        });
      }

      // Find the Excel file
      const excelFile = await ExcelFile.findById(fileId).populate('uploadedBy', 'role');
      if (!excelFile) {
        return res.status(404).json({
          success: false,
          message: 'File not found'
        });
      }

      // Verify the file was uploaded by the current admin
      if (excelFile.uploadedBy._id.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only update shared admins for files you uploaded'
        });
      }

      // Verify current admin has sharing permission
      const currentUser = await User.findById(req.user._id).select('canShareFiles');
      if (!currentUser.canShareFiles) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to share files with other admins'
        });
      }

      // Remove self from shared admins (admin is already the primary admin)
      sharedAdminIds = sharedAdminIds.filter(id => id.toString() !== req.user._id.toString());

      // ============================================================
      // 🛡️ FILTER OUT DELETED/INACTIVE ADMINS BEFORE VALIDATION
      // ============================================================
      if (sharedAdminIds.length > 0) {
        // Check which admins are active and not deleted
        const allSharedAdminUsers = await User.find({
          _id: { $in: sharedAdminIds },
          role: 'admin'
        }).select('_id isActive isDeleted');

        // Separate active and inactive/deleted admins
        const activeSharedAdminIds = [];
        const inactiveSharedAdminIds = [];
        
        allSharedAdminUsers.forEach(admin => {
          if (admin.isActive && !admin.isDeleted) {
            activeSharedAdminIds.push(admin._id.toString());
          } else {
            inactiveSharedAdminIds.push(admin._id.toString());
          }
        });

        // Check for invalid admin IDs (not found in database at all)
        const foundSharedAdminIds = allSharedAdminUsers.map(admin => admin._id.toString());
        const invalidSharedAdminIds = sharedAdminIds.filter(id => !foundSharedAdminIds.includes(id.toString()));

        // Filter out deleted/inactive/invalid admins
        sharedAdminIds = sharedAdminIds.filter(id => 
          activeSharedAdminIds.includes(id.toString())
        );

        // Log if any admins were filtered out
        if (inactiveSharedAdminIds.length > 0 || invalidSharedAdminIds.length > 0) {
          console.log(`⚠️ Filtered out ${inactiveSharedAdminIds.length + invalidSharedAdminIds.length} inactive/deleted/invalid admin(s) from shared admins update:`);
          if (inactiveSharedAdminIds.length > 0) {
            console.log(`   - Inactive/Deleted: ${inactiveSharedAdminIds.join(', ')}`);
          }
          if (invalidSharedAdminIds.length > 0) {
            console.log(`   - Invalid IDs: ${invalidSharedAdminIds.join(', ')}`);
          }
          console.log(`   - Active shared admins kept: ${sharedAdminIds.join(', ')}`);
        }

        // Validate remaining shared admin IDs exist and are admins (should all pass now)
        const sharedAdminsUsers = await User.find({
          _id: { $in: sharedAdminIds },
          role: 'admin',
          isActive: true,
          isDeleted: { $ne: true }
        });

        // This check should now always pass since we filtered above, but keep for safety
        if (sharedAdminsUsers.length !== sharedAdminIds.length) {
          return res.status(400).json({
            success: false,
            message: 'One or more admin IDs are invalid or inactive'
          });
        }
      }

      // Store previous shared admins for cache clearing (convert to strings for comparison)
      const previousSharedAdmins = (excelFile.sharedAdmins || []).map(id => id.toString());

      // Convert string IDs to ObjectIds for MongoDB (ensure it's always an array, even if empty)
      const sharedAdminObjectIds = Array.isArray(sharedAdminIds) 
        ? sharedAdminIds.map(id => new mongoose.Types.ObjectId(id))
        : [];

      // Update shared admins (explicitly set to array to ensure proper saving)
      excelFile.sharedAdmins = sharedAdminObjectIds;
      excelFile.markModified('sharedAdmins'); // Explicitly mark as modified for Mongoose
      await excelFile.save();

      console.log(`✅ Updated shared admins for file ${fileId}:`, {
        previous: previousSharedAdmins,
        new: sharedAdminIds,
        removed: previousSharedAdmins.filter(id => !sharedAdminIds.includes(id)),
        added: sharedAdminIds.filter(id => !previousSharedAdmins.includes(id))
      });

      // Reload the file to get fresh data
      const updatedFile = await ExcelFile.findById(fileId).populate('sharedAdmins', 'name email');

      // Clear all relevant caches
      clearSearchCache();
      clearFileAccessCache();
      clearUserCache(excelFile.uploadedBy.toString());
      
      // Clear cache for all current shared admins
      if (sharedAdminIds.length > 0) {
        sharedAdminIds.forEach(adminId => {
          clearUserCache(adminId);
          console.log(`🔄 Cleared cache for shared admin: ${adminId}`);
        });
      }
      
      // Clear cache for previous admins who no longer have access
      previousSharedAdmins.forEach(adminId => {
        if (!sharedAdminIds.includes(adminId)) {
          clearUserCache(adminId);
          console.log(`🗑️ Cleared cache for removed shared admin: ${adminId}`);
        }
      });

      res.json({
        success: true,
        message: 'Shared admins updated successfully',
        data: updatedFile
      });

    } catch (error) {
      console.error('Update shared admins error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error updating shared admins'
      });
    }
  }
);

// @desc    Reassign Excel file to another admin (SuperAdmin only)
// @route   PUT /api/excel/files/:id/reassign
// @access  Private (SuperAdmin)
router.put('/files/:id/reassign',
  authenticateToken,
  authorizeRole('superSuperAdmin', 'superAdmin'),
  [
    body('assignedTo').notEmpty().withMessage('Admin ID is required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: errors.array()
        });
      }

      const excelFile = await ExcelFile.findById(req.params.id);
      if (!excelFile) {
        return res.status(404).json({
          success: false,
          message: 'Excel file not found'
        });
      }

      // Verify the new assigned admin exists and is active
      const newAssignedAdmin = await User.findById(req.body.assignedTo);
      if (!newAssignedAdmin || newAssignedAdmin.role !== 'admin' || !newAssignedAdmin.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Invalid admin assignment'
        });
      }

      // Update assignment
      excelFile.assignedTo = req.body.assignedTo;
      excelFile.assignedAdmins = [req.body.assignedTo]; // Keep backward compatibility
      await excelFile.save();

      res.json({
        success: true,
        message: 'Excel file reassigned successfully',
        data: excelFile
      });

    } catch (error) {
      console.error('Reassign Excel file error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }
  }
);

// @desc    Update multiple admin assignments for Excel file
// @route   PUT /api/excel/files/:id/update-assignments
// @access  Private (SuperSuperAdmin, SuperAdmin)
router.put('/files/:id/update-assignments',
  authenticateToken,
  authorizeRole('superSuperAdmin', 'superAdmin'),
  [
    body('assignedAdmins').custom((value, { req }) => {
      if (!value) {
        throw new Error('assignedAdmins is required');
      }
      
      // Handle both string and array formats
      let adminArray;
      if (typeof value === 'string') {
        try {
          adminArray = JSON.parse(value);
        } catch (error) {
          throw new Error('assignedAdmins must be a valid JSON array');
        }
      } else {
        adminArray = value;
      }
      
      if (!Array.isArray(adminArray)) {
        throw new Error('assignedAdmins must be an array');
      }
      
      // Validate each admin ID
      const mongoIdRegex = /^[0-9a-fA-F]{24}$/;
      for (let i = 0; i < adminArray.length; i++) {
        if (!mongoIdRegex.test(adminArray[i])) {
          throw new Error(`assignedAdmins[${i}] must be a valid MongoDB ID`);
        }
      }
      
      return true;
    })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: errors.array()
        });
      }

      const excelFile = await ExcelFile.findById(req.params.id);
      if (!excelFile) {
        return res.status(404).json({
          success: false,
          message: 'Excel file not found'
        });
      }

      let { assignedAdmins } = req.body;

      // Parse assignedAdmins if it's a string
      if (typeof assignedAdmins === 'string') {
        try {
          assignedAdmins = JSON.parse(assignedAdmins);
        } catch (error) {
          return res.status(400).json({
            success: false,
            message: 'Invalid assignedAdmins format'
          });
        }
      }

      // ============================================================
      // 🛡️ FILTER OUT DELETED/INACTIVE ADMINS BEFORE VALIDATION
      // ============================================================
      // Check which admins are active and not deleted
      const allAdminUsers = await User.find({
        _id: { $in: assignedAdmins },
        role: 'admin'
      }).select('_id isActive isDeleted');

      // Separate active and inactive/deleted admins
      const activeAdminIds = [];
      const inactiveAdminIds = [];
      
      allAdminUsers.forEach(admin => {
        if (admin.isActive && !admin.isDeleted) {
          activeAdminIds.push(admin._id.toString());
        } else {
          inactiveAdminIds.push(admin._id.toString());
        }
      });

      // Check for invalid admin IDs (not found in database at all)
      const foundAdminIds = allAdminUsers.map(admin => admin._id.toString());
      const invalidAdminIds = assignedAdmins.filter(id => !foundAdminIds.includes(id.toString()));

      // Filter out deleted/inactive/invalid admins
      const filteredAssignedAdmins = assignedAdmins.filter(id => 
        activeAdminIds.includes(id.toString())
      );

      // Ensure at least one active admin remains
      if (filteredAssignedAdmins.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'At least one active admin must be assigned. All provided admins are inactive or deleted.',
          inactiveAdmins: inactiveAdminIds,
          invalidAdmins: invalidAdminIds
        });
      }

      // Log if any admins were filtered out
      if (inactiveAdminIds.length > 0 || invalidAdminIds.length > 0) {
        console.log(`⚠️ Filtered out ${inactiveAdminIds.length + invalidAdminIds.length} inactive/deleted/invalid admin(s) from assignment update:`);
        if (inactiveAdminIds.length > 0) {
          console.log(`   - Inactive/Deleted: ${inactiveAdminIds.join(', ')}`);
        }
        if (invalidAdminIds.length > 0) {
          console.log(`   - Invalid IDs: ${invalidAdminIds.join(', ')}`);
        }
        console.log(`   - Active admins kept: ${filteredAssignedAdmins.join(', ')}`);
      }

      // Use filtered list for validation and update
      assignedAdmins = filteredAssignedAdmins;

      // Verify all remaining assigned admins exist and are active (should all pass now)
      const assignedAdminUsers = await User.find({
        _id: { $in: assignedAdmins },
        role: 'admin',
        isActive: true,
        isDeleted: { $ne: true }
      });

      if (assignedAdminUsers.length !== assignedAdmins.length) {
        return res.status(400).json({
          success: false,
          message: 'One or more assigned admins are invalid or inactive'
        });
      }

      // Check if this is an admin-uploaded file and prevent primary admin change
      const uploader = await User.findById(excelFile.uploadedBy).select('role').lean();
      if (uploader && uploader.role === 'admin') {
        // For admin-uploaded files, the primary admin must remain the uploader
        if (assignedAdmins[0] !== excelFile.uploadedBy.toString()) {
          return res.status(403).json({
            success: false,
            message: 'Cannot change primary admin for files uploaded by admin users. The primary admin must remain the uploader.',
            uploaderId: excelFile.uploadedBy,
            currentPrimary: excelFile.assignedTo,
            attemptedPrimary: assignedAdmins[0]
          });
        }
      }

      // Store previous assignments for cache clearing
      const previousAssignments = [...excelFile.assignedAdmins];

      // Update assignments
      excelFile.assignedAdmins = assignedAdmins;
      excelFile.assignedTo = assignedAdmins[0]; // Keep first admin as primary
      await excelFile.save();

      // Populate the updated file for response
      await excelFile.populate('assignedAdmins', 'name email');

      // Clear all relevant caches
      clearSearchCache(); // Clear all search cache
      clearFileAccessCache(); // Clear file access cache
      clearUserCache(excelFile.uploadedBy.toString()); // Clear uploader cache
      
      // Clear cache for all current assigned admins
      if (excelFile.assignedAdmins && excelFile.assignedAdmins.length > 0) {
        excelFile.assignedAdmins.forEach(admin => {
          clearUserCache(admin._id.toString());
        });
      }
      
      // Clear cache for previous admins who no longer have access
      previousAssignments.forEach(adminId => {
        if (!assignedAdmins.includes(adminId.toString())) {
          clearUserCache(adminId.toString());
          console.log(`🗑️ Cleared cache for removed admin: ${adminId}`);
        }
      });

      res.json({
        success: true,
        message: 'Admin assignments updated successfully',
        data: excelFile
      });

    } catch (error) {
      console.error('Update admin assignments error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }
  }
);

// In-memory cache for search results (short TTL for fresh data)
// IN-MEMORY CACHE: Does NOT use MongoDB storage
// All caching is stored in Node.js memory (Map object) - cleared on server restart
const searchCache = new Map();
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes (shorter for better responsiveness)

// Function to clear search cache when new data is uploaded
function clearSearchCache() {
  searchCache.clear();
  console.log('🗑️ Search cache cleared due to new data upload');
}

// Function to clear cache for specific user
function clearUserCache(userId) {
  const keysToDelete = [];
  for (const [key, value] of searchCache.entries()) {
    if (key.includes(userId)) {
      keysToDelete.push(key);
    }
  }
  keysToDelete.forEach(key => searchCache.delete(key));
  console.log(`🗑️ Cleared cache for user ${userId}: ${keysToDelete.length} entries`);
}

// Function to clear all cache entries related to file access
function clearFileAccessCache() {
  const keysToDelete = [];
  for (const [key, value] of searchCache.entries()) {
    if (key.includes('admin_files_') || key.includes('field_files_') || key.includes('auditor_files_')) {
      keysToDelete.push(key);
    }
  }
  keysToDelete.forEach(key => searchCache.delete(key));
  console.log(`🗑️ Cleared file access cache: ${keysToDelete.length} entries`);
}

// Function to determine visible fields based on user role and file uploader
const getVisibleFields = (userRole, fileUploaderRole) => {
  const baseFields = {
    registration_number: 1,
    chasis_number: 1,
    engine_number: 1,
    customer_name: 1,
    make: 1,
    excel_file: 1,
    createdAt: 1,
    rowNumber: 1
  };

  const restrictedFields = {
    ...baseFields,
    branch: 1,
    loan_number: 1,
    model: 1,
    emi: 1,
    pos: 1,
    bucket: 1,
    address: 1,
    sec_17: 1,
    seasoning: 1,
    allocation: 1,
    product_name: 1,
    first_confirmer_name: 1,
    first_confirmer_no: 1,
    second_confirmer_name: 1,
    second_confirmer_no: 1,
    third_confirmer_name: 1,
    third_confirmer_no: 1
  };

  // SuperAdmin uploaded files - restricted access for non-SuperAdmin roles
  if (fileUploaderRole === 'superAdmin' || fileUploaderRole === 'superSuperAdmin') {
    if (userRole === 'superAdmin' || userRole === 'superSuperAdmin') {
      return restrictedFields; // SuperAdmin can see all fields
    } else {
      return baseFields; // Others see limited fields
    }
  }
  
  // Admin uploaded files
  if (fileUploaderRole === 'admin') {
    if (userRole === 'admin' || userRole === 'auditor') {
      return restrictedFields; // Admin and Auditor can see all fields
    } else if (userRole === 'fieldAgent') {
      return baseFields; // Field Agent sees limited fields
    }
  }

  // Default fallback
  return baseFields;
};

// @desc    Debug endpoint to check file access (remove in production)
// @route   GET /api/excel/debug-access
// @access  Private (All roles)
router.get('/debug-access',
  authenticateToken,
  async (req, res) => {
    try {
      console.log(`🔍 Debug access for user ${req.user._id} (${req.user.role})`);
      
      // Get all files
      const allFiles = await ExcelFile.find({ isActive: true }).select('_id filename originalName assignedTo assignedAdmins uploadedBy').lean();
      console.log(`📁 Total active files: ${allFiles.length}`);
      
      // Get accessible file IDs
      let accessibleFileIds = [];
      if (req.user.role === 'admin') {
        accessibleFileIds = await getExcelFileIdsForAdmin(req.user._id);
      } else if (req.user.role === 'fieldAgent') {
        accessibleFileIds = await getExcelFileIdsForFieldAgent(req.user._id);
      } else if (req.user.role === 'auditor') {
        accessibleFileIds = await getExcelFileIdsForAuditor(req.user._id);
      } else if (req.user.role === 'superAdmin' || req.user.role === 'superSuperAdmin') {
        accessibleFileIds = allFiles.map(file => file._id);
      }
      
      // ✅ PRODUCTION: Use VehicleLookup instead of ExcelVehicle
      const mongoose = require('mongoose');
      const accessibleFileObjectIds = accessibleFileIds.map(id => new mongoose.Types.ObjectId(id));
      
      // Get total vehicle count from VehicleLookup
      const totalVehicles = await VehicleLookup.countDocuments({});
      
      // Get vehicles for accessible files
      const accessibleVehicles = await VehicleLookup.countDocuments({
        excelFileId: { $in: accessibleFileObjectIds }
      });

      // Check for orphaned VehicleLookup records (without valid excelFileId)
      const orphanedVehicles = await VehicleLookup.aggregate([
        {
          $lookup: {
            from: 'excelfiles',
            localField: 'excelFileId',
            foreignField: '_id',
            as: 'fileCheck'
          }
        },
        { $match: { 'fileCheck.0': { $exists: false } } },
        { $count: 'total' }
      ]).then(result => result[0]?.total || 0);
      
      res.json({
        success: true,
        user: {
          id: req.user._id,
          role: req.user.role
        },
        files: {
          total: allFiles.length,
          accessible: accessibleFileIds.length,
          accessibleIds: accessibleFileIds,
          allFiles: allFiles.map(f => ({
            id: f._id,
            name: f.originalName,
            assignedTo: f.assignedTo,
            assignedAdmins: f.assignedAdmins,
            uploadedBy: f.uploadedBy
          }))
        },
        vehicles: {
          total: totalVehicles,
          accessible: accessibleVehicles,
          orphaned: orphanedVehicles
        }
      });
      
    } catch (error) {
      console.error('Debug access error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }
  }
);

// @desc    Clean up orphaned VehicleLookup records (ExcelVehicle removed - use cleanup-orphaned-vehiclelookup instead)
// @route   POST /api/excel/cleanup-orphaned-vehicles
// @access  Private (SuperAdmin, Admin)
// @deprecated Use /api/excel/cleanup-orphaned-vehiclelookup instead
router.post('/cleanup-orphaned-vehicles',
  authenticateToken,
  authorizeRole('superSuperAdmin', 'superAdmin', 'admin'),
  async (req, res) => {
    try {
      console.log('⚠️  DEPRECATED: Use /api/excel/cleanup-orphaned-vehiclelookup instead');
      
      // ✅ PRODUCTION: ExcelVehicle removed - redirect to VehicleLookup cleanup
      // Find orphaned VehicleLookup records (without valid excelFileId)
      const orphanedVehicles = await VehicleLookup.aggregate([
        {
          $lookup: {
            from: 'excelfiles',
            localField: 'excelFileId',
            foreignField: '_id',
            as: 'fileCheck'
          }
        },
        { $match: { 'fileCheck.0': { $exists: false } } },
        { $project: { _id: 1, excelFileId: 1 } }
      ]);

      console.log(`🔍 Found ${orphanedVehicles.length} orphaned VehicleLookup records`);

      if (orphanedVehicles.length > 0) {
        const orphanedIds = orphanedVehicles.map(v => v._id);
        const deleteResult = await VehicleLookup.deleteMany({ _id: { $in: orphanedIds } });
        console.log(`🗑️ Deleted ${deleteResult.deletedCount} orphaned VehicleLookup records`);
      }

      res.json({
        success: true,
        message: `Cleaned up ${orphanedVehicles.length} orphaned VehicleLookup records (ExcelVehicle removed)`,
        deletedCount: orphanedVehicles.length,
        note: 'ExcelVehicle model has been removed. Use /api/excel/cleanup-orphaned-vehiclelookup for future cleanups.'
      });
      
    } catch (error) {
      console.error('Orphaned vehicle cleanup error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }
  }
);

// @desc    Get cache status (for testing)
// @route   GET /api/excel/cache-status
// @access  Private (SuperAdmin, Admin)
router.get('/cache-status',
  authenticateToken,
  authorizeRole('superSuperAdmin', 'superAdmin', 'admin'),
  async (req, res) => {
    try {
      const cacheEntries = [];
      for (const [key, value] of searchCache.entries()) {
        cacheEntries.push({
          key,
          timestamp: value.timestamp,
          age: Date.now() - value.timestamp,
          dataLength: Array.isArray(value.data) ? value.data.length : 'N/A'
        });
      }
      
      res.json({
        success: true,
        cacheSize: searchCache.size,
        cacheTTL: CACHE_TTL,
        entries: cacheEntries
      });
      
    } catch (error) {
      console.error('Cache status error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }
  }
);

// @desc    Force clear all caches (for testing)
// @route   POST /api/excel/clear-cache
// @access  Private (SuperAdmin, Admin)
router.post('/clear-cache',
  authenticateToken,
  authorizeRole('superSuperAdmin', 'superAdmin', 'admin'),
  async (req, res) => {
    try {
      const cacheSize = searchCache.size;
      clearSearchCache();
      clearFileAccessCache();
      
      res.json({
        success: true,
        message: `Cleared all caches (${cacheSize} entries)`,
        clearedEntries: cacheSize
      });
      
    } catch (error) {
      console.error('Clear cache error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }
  }
);

// @desc    Pre-cache accessible Excel files for faster search
// @route   POST /api/excel/pre-cache-files
// @access  Private (All roles)
router.post('/pre-cache-files',
  authenticateToken,
  async (req, res) => {
    try {
      console.log(`🚀 Pre-cache request from user ${req.user._id} (role: ${req.user.role})`);

      // Get accessible file IDs based on user role
      let accessibleFileIds = [];
      if (req.user.role === 'admin') {
        accessibleFileIds = await getExcelFileIdsForAdmin(req.user._id);
      } else if (req.user.role === 'fieldAgent') {
        accessibleFileIds = await getExcelFileIdsForFieldAgent(req.user._id);
      } else if (req.user.role === 'auditor') {
        accessibleFileIds = await getExcelFileIdsForAuditor(req.user._id);
      } else if (req.user.role === 'superAdmin' || req.user.role === 'superSuperAdmin') {
        const allFiles = await ExcelFile.find({ isActive: true }).select('_id').lean();
        accessibleFileIds = allFiles.map(file => file._id);
      }

      if (accessibleFileIds.length === 0) {
        return res.json({
          success: true,
          message: 'No accessible files to cache',
          results: {
            total: 0,
            cached: 0,
            skipped: 0,
            errors: []
          }
        });
      }

      // Get ExcelFile documents with filePath/gcsFileUrl
      const excelFiles = await ExcelFile.find({
        _id: { $in: accessibleFileIds },
        isActive: true
      })
      .select('_id originalName filename filePath')
      .lean();

      // LEVEL 4: Get accessible GCS files (no gcsFileUrl in VehicleLookup)
      const accessibleFiles = await ExcelFile.find({ 
        _id: { $in: accessibleFileIds },
        isActive: true 
      }).select('filePath').lean();
      
      const accessibleGcsUrls = accessibleFiles
        .map(file => file.filePath)
        .filter(url => url && (url.includes('storage.googleapis.com') || url.includes('gcs')));
      
      // LEVEL 4: No need to query VehicleLookup for file URLs - we already have them from ExcelFile
      // Just get the unique GCS URLs
      const uniqueGcsUrls = [...new Set(accessibleGcsUrls)];

      // LEVEL 4: Map GCS URLs to files (gcsFileUrl removed from VehicleLookup)
      const fileGcsMap = new Map();
      excelFiles.forEach(file => {
        if (file.filePath && (file.filePath.includes('storage.googleapis.com') || file.filePath.includes('gcs'))) {
          fileGcsMap.set(file._id.toString(), file.filePath);
        }
      });

      // LEVEL 4: Add GCS URLs to excelFiles (from filePath, not VehicleLookup)
      const filesToCache = excelFiles.map(file => {
        const fileId = file._id.toString();
        const gcsFileUrl = fileGcsMap.get(fileId) || file.filePath;
        return {
          ...file,
          gcsFileUrl: gcsFileUrl // Derived from ExcelFile.filePath
        };
      }).filter(file => file.gcsFileUrl && file.gcsFileUrl.includes('storage.googleapis.com'));

      console.log(`📁 Found ${filesToCache.length} files to cache (out of ${excelFiles.length} accessible files)`);

      // Pre-cache files
      const results = await preCacheExcelFiles(filesToCache);

      res.json({
        success: true,
        message: `Pre-cached ${results.cached} files, ${results.skipped} already cached, ${results.errors.length} errors`,
        results: results
      });
    } catch (error) {
      console.error('Pre-cache error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to pre-cache files',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// @desc    Get cache details (files, sizes, timestamps)
// @route   GET /api/excel/cache-details
// @access  Private (All roles)
router.get('/cache-details',
  authenticateToken,
  async (req, res) => {
    try {
      const cacheDetails = getCacheDetails();
      res.json({
        success: true,
        cache: cacheDetails
      });
    } catch (error) {
      console.error('Cache details error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get cache details',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// @desc    Test endpoint to check Excel file cleanup (remove in production)
// @route   GET /api/excel/cleanup-test
// @access  Private (SuperAdmin, Admin)
router.get('/cleanup-test',
  authenticateToken,
  authorizeRole('superSuperAdmin', 'superAdmin', 'admin'),
  async (req, res) => {
    try {
      // Get all Excel files from database
      const dbFiles = await ExcelFile.find({});
      
      // Get all physical files from directory
      const uploadDir = path.join(__dirname, '../uploads/excel');
      const physicalFiles = await fs.readdir(uploadDir);
      
      // Find orphaned files (files that exist physically but not in database)
      const dbFilenames = dbFiles.map(file => file.filename);
      const orphanedFiles = physicalFiles.filter(filename => !dbFilenames.includes(filename));
      
      // Find missing files (files that exist in database but not physically)
      const physicalFilenames = physicalFiles;
      const missingFiles = dbFiles.filter(file => !physicalFilenames.includes(file.filename));
      
      res.json({
        success: true,
        data: {
          totalDbFiles: dbFiles.length,
          totalPhysicalFiles: physicalFiles.length,
          orphanedFiles: orphanedFiles,
          missingFiles: missingFiles.map(file => ({
            id: file._id,
            filename: file.filename,
            filePath: file.filePath
          })),
          dbFiles: dbFiles.map(file => ({
            id: file._id,
            filename: file.filename,
            filePath: file.filePath,
            status: file.status
          }))
        }
      });
      
    } catch (error) {
      console.error('Excel cleanup test error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }
  }
);

// @desc    Clean up orphaned Excel files (remove in production)
// @route   POST /api/excel/cleanup-orphaned
// @access  Private (SuperAdmin, Admin)
router.post('/cleanup-orphaned',
  authenticateToken,
  authorizeRole('superSuperAdmin', 'superAdmin', 'admin'),
  async (req, res) => {
    try {
      // Get all Excel files from database
      const dbFiles = await ExcelFile.find({});
      
      // Get all physical files from directory
      const uploadDir = path.join(__dirname, '../uploads/excel');
      const physicalFiles = await fs.readdir(uploadDir);
      
      // Find orphaned files (files that exist physically but not in database)
      const dbFilenames = dbFiles.map(file => file.filename);
      const orphanedFiles = physicalFiles.filter(filename => !dbFilenames.includes(filename));
      
      let deletedCount = 0;
      
      // Delete orphaned files
      for (const filename of orphanedFiles) {
        try {
          const filePath = path.join(uploadDir, filename);
          await fs.unlink(filePath);
          deletedCount++;
          console.log(`✅ Deleted orphaned Excel file: ${filename}`);
        } catch (error) {
          console.error(`❌ Error deleting orphaned file ${filename}:`, error.message);
        }
      }
      
      res.json({
        success: true,
        message: `Cleaned up ${deletedCount} orphaned Excel files`,
        deletedCount,
        orphanedFiles
      });
      
    } catch (error) {
      console.error('Excel cleanup error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }
  }
);

// @desc    ULTRA-FAST vehicle search - Phase 1: List only (reg + chassis)
// @route   GET /api/excel/vehicles  
// @access  Private (All roles)
router.get('/vehicles',
  authenticateToken,
  async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = Math.min(parseInt(req.query.limit) || 20, 1000); // Increased to show all results
      const { search, searchType, stateCode, lastFourDigits } = req.query;

      // Validate search termrr
      if (!search || search.trim().length < 3) {
        return res.json({
          success: true,
          data: [],
          pagination: { page, limit, total: 0, pages: 0 },
          message: 'Enter at least 3 characters to search'
        });
      }

      const searchTerm = search.trim();
      
      // ============================================================
      // 🚨 SECURITY: Get accessible file IDs FIRST (CRITICAL)
      // ============================================================
      let accessibleFileIds = [];
      
      if (req.user.role === 'admin') {
        accessibleFileIds = await getExcelFileIdsForAdmin(req.user._id);
      } else if (req.user.role === 'fieldAgent') {
        accessibleFileIds = await getExcelFileIdsForFieldAgent(req.user._id);
      } else if (req.user.role === 'auditor') {
        accessibleFileIds = await getExcelFileIdsForAuditor(req.user._id);
      } else if (req.user.role === 'superAdmin' || req.user.role === 'superSuperAdmin') {
        const cacheKey = `super_admin_files`;
        const cached = searchCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
          accessibleFileIds = cached.data;
        } else {
          const allFiles = await ExcelFile.find({ isActive: true }).select('_id').lean();
          accessibleFileIds = allFiles.map(file => file._id);
          searchCache.set(cacheKey, {
            data: accessibleFileIds,
            timestamp: Date.now()
          });
        }
      }

      if (accessibleFileIds.length === 0) {
        return res.json({
          success: true,
          data: [],
          pagination: { page, limit, total: 0, pages: 0 },
          message: 'No accessible files found'
        });
      }

      // ============================================================
      // ⚡ PHASE 1: FAST SEARCH - MongoDB ONLY (NO GCS, NO EXCEL)
      // ============================================================
      const startTime = Date.now();
      const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Build search query
      let searchQuery = {};

      if (searchType === 'registration_number') {
        if (stateCode || lastFourDigits) {
          const searchDigits = lastFourDigits || (searchTerm.match(/\d{1,4}$/) ? searchTerm.match(/\d{1,4}$/)[0] : null);
          
          if (searchDigits && searchDigits.length >= 1) {
            const stateCodeQuery = buildStateCodeSearchQuery(stateCode || 'ALL', searchDigits);
            if (stateCodeQuery) {
              searchQuery = { ...stateCodeQuery };
            } else {
              searchQuery.registrationNumber = { $regex: escapedTerm, $options: 'i' };
            }
          } else {
            searchQuery.registrationNumber = { $regex: escapedTerm, $options: 'i' };
          }
        } else {
          const parsed = parseRegistrationNumber(searchTerm);
          if (parsed) {
            const regexPattern = `^${parsed.stateCode}.*${parsed.lastFourDigits}$`;
            searchQuery = {
              registrationNumber: { $regex: regexPattern, $options: 'i' }
            };
          } else {
            searchQuery.registrationNumber = { $regex: escapedTerm, $options: 'i' };
          }
        }
      } else if (searchType === 'chasis_number') {
        searchQuery.chassisNumber = { $regex: escapedTerm, $options: 'i' };
      } else {
        const parsed = parseRegistrationNumber(searchTerm);
        if (parsed) {
          const regexPattern = `^${parsed.stateCode}.*${parsed.lastFourDigits}$`;
          searchQuery.$or = [
            { registrationNumber: { $regex: regexPattern, $options: 'i' } },
            { chassisNumber: { $regex: escapedTerm, $options: 'i' } }
          ];
        } else {
          searchQuery.$or = [
            { registrationNumber: { $regex: escapedTerm, $options: 'i' } },
            { chassisNumber: { $regex: escapedTerm, $options: 'i' } }
          ];
        }
      }

      // Add file access filter (CRITICAL SECURITY)
      const mongoose = require('mongoose');
      const accessibleFileObjectIds = accessibleFileIds.map(id => new mongoose.Types.ObjectId(id));
      
      const finalSearchQuery = {
        ...searchQuery,
        excelFileId: { $in: accessibleFileObjectIds }
      };

      // ============================================================
      // ⚡ FETCH MINIMAL DATA: Only reg + chassis + fileId
      // ============================================================
      const [totalCount, lookups] = await Promise.all([
        VehicleLookup.countDocuments(finalSearchQuery),
        VehicleLookup.find(finalSearchQuery)
          .select('registrationNumber chassisNumber excelFileId _id')
          .sort({ registrationNumber: 1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean()
      ]);

      // ============================================================
      // 📦 FETCH FILE METADATA (for filename visibility)
      // ============================================================
      const fileIds = [...new Set(lookups.map(l => l.excelFileId?.toString()).filter(Boolean))];
      const excelFiles = await ExcelFile.find({ 
        _id: { $in: fileIds.map(id => new mongoose.Types.ObjectId(id)) },
        isActive: true 
      })
        .select('_id originalName filename uploadedBy assignedTo assignedAdmins sharedAdmins createdAt')
        .lean();

      // Create file map
      const fileMap = new Map();
      excelFiles.forEach(file => {
        fileMap.set(file._id.toString(), file);
      });

      // Get uploaders (for dataType)
      const uploaderIds = [...new Set(excelFiles.map(f => f.uploadedBy?.toString()).filter(Boolean))];
      const uploaders = await User.find({ _id: { $in: uploaderIds } })
        .select('_id role name')
        .lean();

      const uploaderMap = new Map();
      uploaders.forEach(uploader => {
        uploaderMap.set(uploader._id.toString(), uploader);
      });

      // Get primary admins (for dataType)
      const primaryAdminIds = [...new Set(excelFiles.map(f => f.assignedTo?.toString()).filter(Boolean))];
      const primaryAdminMap = new Map();
      if (primaryAdminIds.length > 0) {
        const primaryAdmins = await User.find({ _id: { $in: primaryAdminIds.map(id => new mongoose.Types.ObjectId(id)) } })
          .select('_id name')
          .lean();
        primaryAdmins.forEach(admin => {
          primaryAdminMap.set(admin._id.toString(), admin.name);
        });
      }

      // Pre-fetch user admin info for auditors and field agents
      let userAdmin = null;
      if (req.user.role === 'auditor' || req.user.role === 'fieldAgent') {
        if (req.user.createdBy) {
          userAdmin = await User.findById(req.user.createdBy).select('_id role');
        }
      }

      // ============================================================
      // 🎭 APPLY VISIBILITY RULES (filename masking)
      // ============================================================
      // ============================================================
// 🎭 APPLY VISIBILITY RULES (filename masking)
// ============================================================
const results = lookups.map(lookup => {
  const excelFile = fileMap.get(lookup.excelFileId?.toString());
  if (!excelFile) return null;

  const uploader = uploaderMap.get(excelFile.uploadedBy?.toString());
  const uploaderRole = uploader?.role;

  // Determine data type
  let dataType;
  if (uploaderRole === 'superAdmin' || uploaderRole === 'superSuperAdmin') {
    const primaryAdminId = excelFile.assignedTo?.toString();
    const primaryAdminName = primaryAdminId ? primaryAdminMap.get(primaryAdminId) : null;
    dataType = primaryAdminName || 'ADMIN';
  } else if (uploaderRole === 'admin') {
    dataType = uploader?.name || 'ADMIN';
  } else {
    dataType = 'SELF DATA';
  }

  // Apply filename visibility using centralized helper
  const excelFileWithVisibility = getExcelFileWithVisibility({
    user: req.user,
    file: {
      ...excelFile,
      uploaderRole: uploaderRole
    },
    userAdmin: userAdmin
  });

  // ============================================================
  // ⚡ PHASE 1 RESPONSE: Minimal data (NO FULL FIELDS YET)
  // ============================================================
  return {
    _id: lookup._id,
    registration_number: lookup.registrationNumber,
    chasis_number: lookup.chassisNumber,
    dataType: dataType,
    excel_file: {
      _id: excelFileWithVisibility._id,
      originalName: excelFileWithVisibility.originalName,
      filename: excelFileWithVisibility.filename
    },
    // ✅ CRITICAL: Store metadata for sorting (not visible to user)
    _internalMetadata: {
      excelFileId: excelFile._id.toString(),
      uploaderRole: uploaderRole,
      uploadedById: excelFile.uploadedBy?.toString(),
      assignedToId: excelFile.assignedTo?.toString()
    },
    // 🔗 Phase 2 trigger: Frontend will call /vehicles/:id/details for full details
    detailsAvailable: true
  };
}).filter(Boolean);

// ✅ FIXED SORTING - Own data first (priority 0), then others (priority 1)
results.sort((a, b) => {
  // Reconstruct vehicle object for getSearchPriority (using metadata)
  const vehicleA = {
    excel_file: {
      _id: a._internalMetadata.excelFileId,
      uploadedBy: a._internalMetadata.uploadedById,
      assignedTo: a._internalMetadata.assignedToId
    },
    uploaderRole: a._internalMetadata.uploaderRole
  };
  
  const vehicleB = {
    excel_file: {
      _id: b._internalMetadata.excelFileId,
      uploadedBy: b._internalMetadata.uploadedById,
      assignedTo: b._internalMetadata.assignedToId
    },
    uploaderRole: b._internalMetadata.uploaderRole
  };
  
  const priorityA = getSearchPriority({ 
    vehicle: vehicleA, 
    user: req.user, 
    userAdmin: userAdmin 
  });
  const priorityB = getSearchPriority({ 
    vehicle: vehicleB, 
    user: req.user, 
    userAdmin: userAdmin 
  });
  
  // Primary sort: by priority (0 = own data first, 1 = others)
  if (priorityA !== priorityB) {
    return priorityA - priorityB;
  }
  
  // Secondary sort: alphabetically by registration number for stable ordering
  const regA = a.registration_number || '';
  const regB = b.registration_number || '';
  return regA.localeCompare(regB);
});

// ✅ CLEANUP: Remove internal metadata before sending to frontend
results.forEach(result => {
  delete result._internalMetadata;
});

      const queryTime = Date.now() - startTime;
      console.log(`⚡ PHASE 1 search completed in ${queryTime}ms for "${searchTerm}" (${results.length} results)`);

      res.json({
        success: true,
        data: results,
        pagination: {
          page,
          limit,
          total: totalCount,
          pages: Math.ceil(totalCount / limit)
        },
        performance: {
          queryTime: `${queryTime}ms`,
          resultsCount: results.length,
          totalResults: totalCount,
          phase: 'PHASE_1_FAST_LIST',
          searchType: searchType === 'all' ? 'multi-field' : searchType
        }
      });

    } catch (error) {
      console.error('🔥 Search error:', error);
      res.status(500).json({
        success: false,
        message: 'Search error - please try again',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// @desc    Get full vehicle details - Phase 2: Details on demand
// @route   GET /api/excel/vehicles/:id/details
// @access  Private (All roles)
router.get('/vehicles/:id/details',
  authenticateToken,
  async (req, res) => {
    try {
      const { id } = req.params;

      // Validate ObjectId
      const mongoose = require('mongoose');
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid vehicle ID'
        });
      }

      const startTime = Date.now();

      // ============================================================
      // 🚨 SECURITY: Verify file access FIRST
      // ============================================================
      let accessibleFileIds = [];
      
      if (req.user.role === 'admin') {
        accessibleFileIds = await getExcelFileIdsForAdmin(req.user._id);
      } else if (req.user.role === 'fieldAgent') {
        accessibleFileIds = await getExcelFileIdsForFieldAgent(req.user._id);
      } else if (req.user.role === 'auditor') {
        accessibleFileIds = await getExcelFileIdsForAuditor(req.user._id);
      } else if (req.user.role === 'superAdmin' || req.user.role === 'superSuperAdmin') {
        const allFiles = await ExcelFile.find({ isActive: true }).select('_id').lean();
        accessibleFileIds = allFiles.map(file => file._id);
      }

      // Find the lookup
      const lookup = await VehicleLookup.findOne({
        _id: new mongoose.Types.ObjectId(id),
        excelFileId: { $in: accessibleFileIds.map(fid => new mongoose.Types.ObjectId(fid)) }
      }).lean();

      if (!lookup) {
        return res.status(404).json({
          success: false,
          message: 'Vehicle not found or access denied'
        });
      }

      // Get Excel file metadata
      const excelFile = await ExcelFile.findById(lookup.excelFileId)
        .select('_id originalName filename uploadedBy assignedTo assignedAdmins sharedAdmins createdAt filePath')
        .lean();

      if (!excelFile) {
        return res.status(404).json({
          success: false,
          message: 'Excel file not found'
        });
      }

      // Get uploader info
      const uploader = await User.findById(excelFile.uploadedBy).select('_id role name').lean();
      const uploaderRole = uploader?.role;

      // ============================================================
      // ⚡ PHASE 2: Fetch FULL data from GCS (ONE file, ONE row)
      // ============================================================
      const gcsFileUrl = excelFile.filePath;
      if (!gcsFileUrl || (!gcsFileUrl.includes('storage.googleapis.com') && !gcsFileUrl.includes('gcs'))) {
        return res.status(404).json({
          success: false,
          message: 'Vehicle data not available (GCS not configured)'
        });
      }

      // Search this ONE file for this ONE vehicle
      const vehicleDataArray = await searchVehiclesInExcel(gcsFileUrl, [lookup]);
      const vehicleData = vehicleDataArray[0];

      if (!vehicleData) {
        return res.status(404).json({
          success: false,
          message: 'Vehicle details not found in Excel file'
        });
      }

      // Get primary admin for dataType
      let primaryAdminName = null;
      if (uploaderRole === 'superAdmin' || uploaderRole === 'superSuperAdmin') {
        const primaryAdminId = excelFile.assignedTo?.toString();
        if (primaryAdminId) {
          const primaryAdmin = await User.findById(primaryAdminId).select('name').lean();
          primaryAdminName = primaryAdmin?.name;
        }
      }

      // Determine data type
      let dataType;
      if (uploaderRole === 'superAdmin' || uploaderRole === 'superSuperAdmin') {
        dataType = primaryAdminName || 'ADMIN';
      } else if (uploaderRole === 'admin') {
        dataType = uploader?.name || 'ADMIN';
      } else {
        dataType = 'SELF DATA';
      }

      // Pre-fetch user admin info for auditors and field agents
      let userAdmin = null;
      if (req.user.role === 'auditor' || req.user.role === 'fieldAgent') {
        if (req.user.createdBy) {
          userAdmin = await User.findById(req.user.createdBy).select('_id role');
        }
      }

      // Apply filename visibility using centralized helper
      const excelFileWithVisibility = getExcelFileWithVisibility({
        user: req.user,
        file: {
          ...excelFile,
          uploaderRole: uploaderRole
        },
        userAdmin: userAdmin
      });

      // ============================================================
      // 🎭 APPLY VISIBILITY RULES (field-level access)
      // ============================================================
      const primaryAdminId = excelFile.assignedTo?.toString();
      const uploadedById = excelFile.uploadedBy?.toString();
      const currentUserId = req.user._id.toString();
      const isSuperAdminUpload = uploaderRole === 'superAdmin' || uploaderRole === 'superSuperAdmin';
      const isAdminUpload = uploaderRole === 'admin';

      // Base fields (restricted data)
      const baseFields = {
        _id: lookup._id,
        registration_number: vehicleData.registration_number,
        chasis_number: vehicleData.chasis_number,
        engine_number: vehicleData.engine_number,
        customer_name: vehicleData.customer_name,
        make: vehicleData.make,
        excel_file: excelFileWithVisibility,
        createdAt: vehicleData.createdAt,
        rowNumber: vehicleData.rowNumber,
        dataType: dataType
      };

      // All fields (full data)
      const allFields = {
        ...baseFields,
        model: vehicleData.model,
        branch: vehicleData.branch,
        loan_number: vehicleData.loan_number,
        emi: vehicleData.emi,
        pos: vehicleData.pos,
        bucket: vehicleData.bucket,
        address: vehicleData.address,
        sec_17: vehicleData.sec_17,
        seasoning: vehicleData.seasoning,
        allocation: vehicleData.allocation,
        product_name: vehicleData.product_name,
        first_confirmer_name: vehicleData.first_confirmer_name,
        first_confirmer_no: vehicleData.first_confirmer_no,
        second_confirmer_name: vehicleData.second_confirmer_name,
        second_confirmer_no: vehicleData.second_confirmer_no,
        third_confirmer_name: vehicleData.third_confirmer_name,
        third_confirmer_no: vehicleData.third_confirmer_no
      };

      let result = null;

      // ========== SUPER ADMIN UPLOAD FLOW ==========
      if (isSuperAdminUpload) {
        if (req.user.role === 'superSuperAdmin' || req.user.role === 'superAdmin') {
          result = allFields;
        } else if (req.user.role === 'admin') {
          const isPrimaryAdmin = currentUserId === primaryAdminId;
          result = isPrimaryAdmin ? allFields : baseFields;
        } else if (req.user.role === 'auditor') {
          if (userAdmin) {
            const isPrimaryAdminAuditor = userAdmin._id.toString() === primaryAdminId;
            result = isPrimaryAdminAuditor ? allFields : baseFields;
          } else {
            result = { ...baseFields, excel_file: { _id: excelFile._id } };
          }
        } else if (req.user.role === 'fieldAgent') {
          result = { ...baseFields, excel_file: { _id: excelFile._id } };
        }
      }
      
      // ========== ADMIN UPLOAD FLOW ==========
      if (isAdminUpload) {
        const sharedAdmins = excelFile.sharedAdmins || [];
        const isSharedAdmin = sharedAdmins.some(adminId => adminId.toString() === currentUserId);
        
        if (req.user.role === 'superSuperAdmin' || req.user.role === 'superAdmin') {
          result = allFields;
        } else if (req.user.role === 'admin') {
          const isOwner = currentUserId === uploadedById;
          if (isOwner) {
            result = allFields;
          } else if (isSharedAdmin) {
            result = baseFields;
          } else {
            return res.status(403).json({
              success: false,
              message: 'Access denied'
            });
          }
        } else if (req.user.role === 'auditor') {
          if (userAdmin) {
            const isOwnerAuditor = userAdmin._id.toString() === uploadedById;
            const isSharedAdminAuditor = sharedAdmins.some(adminId => adminId.toString() === userAdmin._id.toString());
            
            if (isOwnerAuditor) {
              result = allFields;
            } else if (isSharedAdminAuditor) {
              result = baseFields;
            } else {
              return res.status(403).json({
                success: false,
                message: 'Access denied'
              });
            }
          } else {
            return res.status(403).json({
              success: false,
              message: 'Access denied'
            });
          }
        } else if (req.user.role === 'fieldAgent') {
          if (userAdmin) {
            const isOwnerFieldAgent = userAdmin._id.toString() === uploadedById;
            const isSharedAdminFieldAgent = sharedAdmins.some(adminId => adminId.toString() === userAdmin._id.toString());
            
            if (isOwnerFieldAgent || isSharedAdminFieldAgent) {
              result = { ...baseFields, excel_file: { _id: excelFile._id } };
            } else {
              return res.status(403).json({
                success: false,
                message: 'Access denied'
              });
            }
          } else {
            return res.status(403).json({
              success: false,
              message: 'Access denied'
            });
          }
        }
      }

      if (!result) {
        result = { ...baseFields, excel_file: { _id: excelFile._id } };
      }

      const queryTime = Date.now() - startTime;
      console.log(`⚡ PHASE 2 details fetched in ${queryTime}ms for vehicle ${id}`);

      res.json({
        success: true,
        data: result,
        performance: {
          queryTime: `${queryTime}ms`,
          phase: 'PHASE_2_DETAILS_ON_DEMAND'
        }
      });

    } catch (error) {
      console.error('🔥 Details fetch error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch vehicle details',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// @desc    Get all vehicles for offline sync
// @route   GET /api/excel/vehicles/sync
// @access  Private (All roles)
router.get('/vehicles/sync',
  authenticateToken,
  async (req, res) => {
    try {
      console.log('🔄 Offline sync request from user:', req.user._id, 'role:', req.user.role);

      const page = parseInt(req.query.page) || 1;
      const limit = Math.min(parseInt(req.query.limit) || 100, 2000); // ⚡ Max 2000 for faster sync
      const cursorId = req.query.cursorId; // Cursor for pagination (last _id from previous page) - OPTIMIZED: avoids MongoDB memory

      // Get accessible file IDs (cached per user)
      let accessibleFileIds = [];
      if (req.user.role === 'admin') {
        accessibleFileIds = await getExcelFileIdsForAdmin(req.user._id);
      } else if (req.user.role === 'fieldAgent') {
        accessibleFileIds = await getExcelFileIdsForFieldAgent(req.user._id);
      } else if (req.user.role === 'auditor') {
        accessibleFileIds = await getExcelFileIdsForAuditor(req.user._id);
      } else if (req.user.role === 'superAdmin' || req.user.role === 'superSuperAdmin') {
        // SuperAdmin and SuperSuperAdmin can access all active files
        const allFiles = await ExcelFile.find({ isActive: true }).select('_id').lean();
        accessibleFileIds = allFiles.map(file => file._id);
      }

      // Build query for all accessible vehicles
      const baseQuery = {
        isActive: true
      };

      // Add role-based file access restrictions for all roles
      if (accessibleFileIds.length > 0) {
        baseQuery.excel_file = { $in: accessibleFileIds };
      } else {
        // If no accessible files, return empty results
        return res.json({
          success: true,
          data: [],
          pagination: { page, limit, total: 0, pages: 0 },
          message: 'No accessible files found'
        });
      }

      console.log('🔍 Query for offline sync:', JSON.stringify(baseQuery));

      // ✅ PRODUCTION: Use VehicleLookup + GCS only (ExcelVehicle removed)
      let vehicles = [];
      let totalCount = 0;

      // Try VehicleLookup first (optimized storage)
      if (isGCSConfigured()) {
        try {
          // ✅ STEP 1: Get accessible file IDs (already done above)
          // ✅ STEP 2: Build lookup query WITH excelFileId filter (CRITICAL)
          const mongoose = require('mongoose');
          const accessibleFileObjectIds = accessibleFileIds.map(id => new mongoose.Types.ObjectId(id));
          const lookupQuery = {
            excelFileId: { $in: accessibleFileObjectIds }
          };

          // OPTIMIZED: Use cursor-based pagination with _id (indexed) instead of sorting
          // This avoids MongoDB memory consumption - no sorting needed!
          if (cursorId) {
            // Continue from cursor position - convert string to ObjectId
            try {
              // Validate ObjectId format before converting (mongoose already declared above)
              if (mongoose.Types.ObjectId.isValid(cursorId)) {
                lookupQuery._id = { $gt: new mongoose.Types.ObjectId(cursorId) };
              } else {
                console.warn(`Invalid cursorId format: ${cursorId}, ignoring cursor`);
              }
            } catch (e) {
              console.error('Error converting cursorId to ObjectId:', e);
              // If conversion fails, don't use cursor (will start from beginning)
            }
          }
          
          // Get total count only on first page (cached)
          if (page === 1) {
            totalCount = await VehicleLookup.countDocuments(lookupQuery);
            console.log(`📊 Total vehicles in VehicleLookup: ${totalCount}`);
          }

          // CURSOR-BASED PAGINATION: Use _id index (always indexed, no sorting needed)
          // ✅ STEP 2: Select only fields that exist in VehicleLookup schema
          const lookups = await VehicleLookup.find(lookupQuery)
            .select('registrationNumber chassisNumber excelFileId _id') // ✅ Fixed: removed gcsFileUrl
            .sort({ _id: 1 }) // Sort by _id (indexed, fast, no memory)
            .limit(limit)
            .lean();

          if (lookups.length > 0) {
            // ✅ STEP 3: Group lookups by excelFileId BEFORE hitting GCS
            const lookupsByFileId = new Map();
            lookups.forEach(lookup => {
              const fileId = lookup.excelFileId?.toString();
              if (!fileId) return; // Skip lookups without excelFileId
              
              if (!lookupsByFileId.has(fileId)) {
                lookupsByFileId.set(fileId, []);
              }
              lookupsByFileId.get(fileId).push(lookup);
            });

            // ✅ STEP 4: Resolve filePath from ExcelFile (derive GCS path, NEVER from VehicleLookup)
            const fileIds = Array.from(lookupsByFileId.keys());
            const excelFiles = await ExcelFile.find({ 
              _id: { $in: fileIds.map(id => new mongoose.Types.ObjectId(id)) },
              isActive: true 
            })
              .select('_id originalName filename uploadedBy assignedTo assignedAdmins createdAt filePath')
              .lean();

            // Create maps: fileId → filePath, filePath → ExcelFile
            const fileIdToPathMap = new Map();
            const excelFileMap = new Map();
            excelFiles.forEach(file => {
              const fileId = file._id.toString();
              fileIdToPathMap.set(fileId, file.filePath);
              excelFileMap.set(file.filePath, file);
            });

            // Get uploaders
            const uploaderIds = [...new Set(excelFiles.map(f => f.uploadedBy?.toString()).filter(Boolean))];
            const uploaders = await User.find({ _id: { $in: uploaderIds } })
              .select('_id role name')
              .lean();

            const uploaderMap = new Map();
            uploaders.forEach(uploader => {
              uploaderMap.set(uploader._id.toString(), uploader);
            });

            // Get primary admins (assignedTo) for dataType
            const primaryAdminIds = [...new Set(excelFiles.map(f => f.assignedTo?.toString()).filter(Boolean))];
            const primaryAdminMap = new Map();
            if (primaryAdminIds.length > 0) {
              const primaryAdmins = await User.find({ _id: { $in: primaryAdminIds.map(id => new mongoose.Types.ObjectId(id)) } })
                .select('_id name')
                .lean();
              primaryAdmins.forEach(admin => {
                primaryAdminMap.set(admin._id.toString(), admin.name);
              });
            }

            // ✅ STEP 5: Group lookups by filePath (only search each file with its own lookups)
            const lookupsByFile = new Map(); // Map: gcsFileUrl → lookups[]
            lookupsByFileId.forEach((fileLookups, fileId) => {
              const gcsFileUrl = fileIdToPathMap.get(fileId);
              if (gcsFileUrl && (gcsFileUrl.includes('storage.googleapis.com') || gcsFileUrl.includes('gcs'))) {
                lookupsByFile.set(gcsFileUrl, fileLookups);
              }
            });

            // ✅ STEP 5: Search each file ONCE with only its own lookups
            const gcsFetchPromises = Array.from(lookupsByFile.entries()).map(async ([gcsFileUrl, fileLookups]) => {
              try {
                // Search Excel file for matching vehicles
                const vehicleDataArray = await searchVehiclesInExcel(gcsFileUrl, fileLookups);
                
                return fileLookups.map((lookup, index) => {
                  const vehicleData = vehicleDataArray[index];
                  if (vehicleData) {
                    const excelFile = excelFileMap.get(gcsFileUrl);
                    const uploader = excelFile ? uploaderMap.get(excelFile.uploadedBy?.toString()) : null;
                    
                    // Parse registration number at runtime for offline search (Level 3)
                    const regParsed = vehicleData.registration_number ? parseRegistrationNumber(vehicleData.registration_number) : null;
                    
                    return {
                      ...vehicleData,
                      registration_number: vehicleData.registration_number || vehicleData.registrationNumber || lookup.registrationNumber,
                      chasis_number: vehicleData.chasis_number || vehicleData.chassisNumber || lookup.chassisNumber,
                      // RUNTIME PARSED FIELDS for fast offline search (Level 3)
                      registrationNumberStateCode: regParsed ? regParsed.stateCode : null,
                      registrationNumberLastFour: regParsed ? regParsed.lastFourDigits : null,
                      excel_file: excelFile ? {
                        _id: excelFile._id,
                        filename: excelFile.filename,
                        originalName: excelFile.originalName,
                        uploadedBy: excelFile.uploadedBy,
                        assignedTo: excelFile.assignedTo,
                        assignedAdmins: excelFile.assignedAdmins,
                        createdAt: excelFile.createdAt
                      } : null,
                      uploaderRole: uploader?.role,
                      uploaderName: uploader?.name
                    };
                  }
                  return null;
                }).filter(Boolean);
              } catch (error) {
                console.error(`Error searching vehicles in ${gcsFileUrl}:`, error.message);
                return [];
              }
            });

            const vehicleArrays = await Promise.all(gcsFetchPromises);
            vehicles = vehicleArrays.flat();
            
            // Get last _id for cursor-based pagination (next page)
            let nextCursorId = null;
            if (lookups.length > 0) {
              nextCursorId = lookups[lookups.length - 1]._id.toString();
            }
            
            console.log(`✅ Fetched ${vehicles.length} vehicles from VehicleLookup + GCS for offline sync (cursor: ${nextCursorId || 'none'})`);
            
            // Store cursor in response for next page
            req.nextCursorId = nextCursorId;
          }
        } catch (error) {
          console.error('Error fetching from VehicleLookup:', error);
          // ✅ PRODUCTION: Only VehicleLookup + GCS (ExcelVehicle removed)
          // No legacy fallback - all data must be in VehicleLookup + GCS
        }
      }

      // ✅ PRODUCTION: Only VehicleLookup + GCS (ExcelVehicle removed)
      // No legacy fallback - all data must be in VehicleLookup + GCS
      if (vehicles.length === 0) {
        console.log('📋 No vehicles found in VehicleLookup - ensure files are uploaded with GCS configured');
      }

      console.log(`✅ Found ${vehicles.length} vehicles for offline sync (page ${page}, limit ${limit})`);

      // Pre-fetch user admin info for auditors and field agents
      let userAdmin = null;
      if (req.user.role === 'auditor' || req.user.role === 'fieldAgent') {
        if (req.user.createdBy) {
          userAdmin = await User.findById(req.user.createdBy).select('_id role');
        }
      }

      // Get primary admin map for sync endpoint (if vehicles exist)
      let syncPrimaryAdminMap = new Map();
      if (vehicles.length > 0) {
        const syncPrimaryAdminIds = [...new Set(vehicles.map(v => v.excel_file?.assignedTo?.toString()).filter(Boolean))];
        if (syncPrimaryAdminIds.length > 0) {
          const syncPrimaryAdmins = await User.find({ _id: { $in: syncPrimaryAdminIds.map(id => new mongoose.Types.ObjectId(id)) } })
            .select('_id name')
            .lean();
          syncPrimaryAdmins.forEach(admin => {
            syncPrimaryAdminMap.set(admin._id.toString(), admin.name);
          });
        }
      }

      // Apply role-based field visibility filtering for sync
      const filteredVehicles = vehicles.map(vehicle => {
        const uploaderRole = vehicle.uploaderRole;
        const userRole = req.user.role;
        
        // Determine data type label - show primary admin name instead of "SUPER ADMIN DATA"
        let dataType;
        if (uploaderRole === 'superAdmin' || uploaderRole === 'superSuperAdmin') {
          // Get primary admin name from excel_file.assignedTo
          const primaryAdminId = vehicle.excel_file?.assignedTo?.toString();
          const primaryAdminName = primaryAdminId ? syncPrimaryAdminMap.get(primaryAdminId) : null;
          dataType = primaryAdminName || 'ADMIN';
        } else if (uploaderRole === 'admin') {
          if (userRole === 'admin' && vehicle.excel_file.uploadedBy === req.user._id.toString()) {
            dataType = 'SELF DATA'; // Admin viewing their own uploaded file
          } else {
            // Show admin's name
            dataType = vehicle.uploaderName || 'ADMIN';
          }
        } else {
          dataType = 'SELF DATA';
        }

        // Apply filename visibility using centralized helper
        const syncExcelFileWithVisibility = getExcelFileWithVisibility({
          user: req.user,
          file: {
            ...vehicle.excel_file,
            uploaderRole: uploaderRole // Add uploaderRole for helper function
          },
          userAdmin: userAdmin
        });

        // Parse registration number at runtime for offline search (Level 3)
        const regParsed = vehicle.registration_number ? parseRegistrationNumber(vehicle.registration_number) : null;
        
        // Base fields that are always visible
        const baseFields = {
          registration_number: vehicle.registration_number,
          chasis_number: vehicle.chasis_number,
          engine_number: vehicle.engine_number,
          customer_name: vehicle.customer_name,
          make: vehicle.make,
          excel_file: syncExcelFileWithVisibility,
          createdAt: vehicle.createdAt,
          rowNumber: vehicle.rowNumber,
          dataType: dataType,
          // RUNTIME PARSED FIELDS for fast offline search (Level 3 - no stored fields)
          registrationNumberStateCode: regParsed ? regParsed.stateCode : null,
          registrationNumberLastFour: regParsed ? regParsed.lastFourDigits : null
        };

        // All fields for full access
        const allFields = {
          ...baseFields,
          customer_phone: vehicle.customer_phone,
          customer_email: vehicle.customer_email,
          address: vehicle.address,
          branch: vehicle.branch,
          loan_number: vehicle.loan_number,
          model: vehicle.model,
          emi: vehicle.emi,
          pos: vehicle.pos,
          bucket: vehicle.bucket,
          sec_17: vehicle.sec_17,
          seasoning: vehicle.seasoning,
          allocation: vehicle.allocation,
          product_name: vehicle.product_name,
          first_confirmer_name: vehicle.first_confirmer_name,
          first_confirmer_no: vehicle.first_confirmer_no,
          second_confirmer_name: vehicle.second_confirmer_name,
          second_confirmer_no: vehicle.second_confirmer_no,
          third_confirmer_name: vehicle.third_confirmer_name,
          third_confirmer_no: vehicle.third_confirmer_no,
          assigned_to: vehicle.assigned_to,
          file_name: vehicle.file_name,
          // OPTIMIZED FIELDS already included in baseFields
        };

        // Apply field visibility rules based on requirements (same as search endpoint)
        const primaryAdminId = vehicle.excel_file.assignedTo?.toString();
        const uploadedById = vehicle.excel_file.uploadedBy?.toString();
        const currentUserId = req.user._id.toString();
        const isSuperAdminUpload = uploaderRole === 'superAdmin' || uploaderRole === 'superSuperAdmin';
        const isAdminUpload = uploaderRole === 'admin';

        // Base fields with no filename (for restricted access)
        // Keep IDs so offline primary-admin detection works without exposing filenames
        const baseFieldsWithFile = {
          ...baseFields,
          excel_file: {
            _id: vehicle.excel_file._id,
            uploadedBy: vehicle.excel_file.uploadedBy,
            assignedTo: vehicle.excel_file.assignedTo
            // No filename for restricted access
          }
        };

        // All fields with proper filename visibility
        const allFieldsWithFile = {
          ...allFields,
          excel_file: syncExcelFileWithVisibility
        };

        // ========== SUPER ADMIN UPLOAD FLOW ==========
        if (isSuperAdminUpload) {
          if (userRole === 'superSuperAdmin' || userRole === 'superAdmin') {
            // Super Admin: All data + file name
            return allFieldsWithFile;
          } else if (userRole === 'admin') {
            const isPrimaryAdmin = currentUserId === primaryAdminId;
            if (isPrimaryAdmin) {
              // Primary Admin: All data + file name
              return allFieldsWithFile;
            } else {
              // Assigned Admin (non-primary): Restricted data only + masked file name
              return {
                ...baseFields,
                excel_file: syncExcelFileWithVisibility
              };
            }
          } else if (userRole === 'auditor') {
            if (userAdmin) {
              const isPrimaryAdminAuditor = userAdmin._id.toString() === primaryAdminId;
              if (isPrimaryAdminAuditor) {
                // Primary Admin's Auditor: All data + file name
                return allFieldsWithFile;
              } else {
                // Assigned Admin's Auditor: Restricted data only + masked file name
                return {
                  ...baseFields,
                  excel_file: syncExcelFileWithVisibility
                };
              }
            }
            // Fallback: Restricted data + no file name
            return baseFieldsWithFile;
          } else if (userRole === 'fieldAgent') {
            // Field Agent: Always restricted data + NO file name
            return baseFieldsWithFile;
          }
        }
        
        // ========== ADMIN UPLOAD FLOW ==========
        if (isAdminUpload) {
          if (userRole === 'superSuperAdmin' || userRole === 'superAdmin') {
            // Super Admin: All data + file name
            return allFieldsWithFile;
          } else if (userRole === 'admin') {
            const isOwner = currentUserId === uploadedById;
            if (isOwner) {
              // Owner Admin: All data + file name
              return allFieldsWithFile;
            } else {
              // Non-owner Admin: NO ACCESS - should not see this file at all
              return null; // Will be filtered out
            }
          } else if (userRole === 'auditor') {
            if (userAdmin) {
              const isOwnerAuditor = userAdmin._id.toString() === uploadedById;
              if (isOwnerAuditor) {
                // Owner Admin's Auditor: All data + file name
                return allFieldsWithFile;
              } else {
                // Non-owner Admin's Auditor: NO ACCESS
                return null; // Will be filtered out
              }
            }
            // Fallback: NO ACCESS
            return null;
          } else if (userRole === 'fieldAgent') {
            if (userAdmin) {
              const isOwnerFieldAgent = userAdmin._id.toString() === uploadedById;
              if (isOwnerFieldAgent) {
                // Owner Admin's Field Agent: Restricted data + NO file name
                return baseFieldsWithFile;
              } else {
                // Non-owner Admin's Field Agent: NO ACCESS
                return null; // Will be filtered out
              }
            }
            // Fallback: NO ACCESS
            return null;
          }
        }

        // Default fallback - restricted data + no file name
        return baseFieldsWithFile;
      }).filter(vehicle => vehicle !== null); // Filter out null vehicles (no access)

      // Sort by priority: own data first (priority 0), then others (priority 1)
      // Stable secondary sort by createdAt desc for same priority
      filteredVehicles.sort((a, b) => {
        const priorityA = getSearchPriority({ vehicle: a, user: req.user, userAdmin: userAdmin });
        const priorityB = getSearchPriority({ vehicle: b, user: req.user, userAdmin: userAdmin });
        
        // Primary sort: by priority (0 = own data first)
        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }
        
        // Secondary sort: by createdAt desc (newest first) for stable ordering
        const createdAtA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const createdAtB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return createdAtB - createdAtA; // Descending (newest first)
      });

      // OPTIMIZED: Include cursor for next page (cursor-based pagination)
      // This avoids MongoDB memory consumption from sorting
      res.json({
        success: true,
        data: filteredVehicles,
        pagination: {
          page,
          limit,
          total: totalCount,
          pages: Math.ceil(totalCount / limit),
          // Cursor for next page (if available) - use this instead of page number for faster pagination
          nextCursorId: req.nextCursorId || null,
          hasMore: filteredVehicles.length === limit // If we got full limit, there might be more
        },
        message: `Successfully retrieved ${filteredVehicles.length} vehicles for offline use (page ${page} of ${Math.ceil(totalCount / limit)})`,
        count: filteredVehicles.length,
        totalCount
      });

    } catch (error) {
      console.error('❌ Error in offline sync:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve vehicles for offline sync',
        error: error.message
      });
    }
  }
);

// @desc    Check if there are new files/data updates available for sync
// @route   GET /api/excel/vehicles/sync/check-updates
// @access  Private (All roles)
router.get('/vehicles/sync/check-updates',
  authenticateToken,
  async (req, res) => {
    try {
      console.log('🔍 Checking for sync updates for user:', req.user._id, 'role:', req.user.role);

      // Get accessible file IDs (same logic as sync endpoint)
      let accessibleFileIds = [];
      if (req.user.role === 'admin') {
        accessibleFileIds = await getExcelFileIdsForAdmin(req.user._id);
      } else if (req.user.role === 'fieldAgent') {
        accessibleFileIds = await getExcelFileIdsForFieldAgent(req.user._id);
      } else if (req.user.role === 'auditor') {
        accessibleFileIds = await getExcelFileIdsForAuditor(req.user._id);
      } else if (req.user.role === 'superAdmin' || req.user.role === 'superSuperAdmin') {
        const allFiles = await ExcelFile.find({ isActive: true }).select('_id').lean();
        accessibleFileIds = allFiles.map(file => file._id);
      }

      if (accessibleFileIds.length === 0) {
        return res.json({
          success: true,
          hasUpdates: false,
          latestFileUpdateTime: null,
          message: 'No accessible files found'
        });
      }

      // Get the latest file update time (max of createdAt and updatedAt)
      const latestFile = await ExcelFile.findOne({
        _id: { $in: accessibleFileIds },
        isActive: true
      })
      .sort({ updatedAt: -1, createdAt: -1 })
      .select('updatedAt createdAt')
      .lean();

      // LEVEL 2: Also check latest vehicle update time from VehicleLookup (no createdAt field)
      // Since createdAt is removed, we'll use _id for approximate ordering
      // Note: This is approximate since _id contains timestamp, but not exact creation time
      const accessibleFiles = await ExcelFile.find({ 
        _id: { $in: accessibleFileIds },
        isActive: true 
      }).select('filePath').lean();
      
      // ✅ FIX: Derive GCS path from ExcelFile, NEVER from VehicleLookup
      // VehicleLookup doesn't have gcsFileUrl - we must query by excelFileId
      const mongoose = require('mongoose');
      const accessibleFileObjectIds = accessibleFileIds.map(id => new mongoose.Types.ObjectId(id));
      
      const latestVehicle = await VehicleLookup.findOne({
        excelFileId: { $in: accessibleFileObjectIds }
      })
      .sort({ _id: -1 }) // Use _id instead of createdAt (contains timestamp)
      .select('_id excelFileId')
      .lean();

      let latestUpdateTime = null;
      if (latestFile) {
        latestUpdateTime = latestFile.updatedAt || latestFile.createdAt;
      }
      // LEVEL 2: createdAt removed from VehicleLookup, so we only use file update time
      // Vehicle updates are reflected in ExcelFile.updatedAt when files are re-uploaded

      res.json({
        success: true,
        hasUpdates: latestUpdateTime != null,
        latestFileUpdateTime: latestUpdateTime ? latestUpdateTime.toISOString() : null,
        accessibleFilesCount: accessibleFileIds.length
      });
    } catch (error) {
      console.error('❌ Error checking for sync updates:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to check for sync updates',
        error: error.message
      });
    }
  }
);

// @desc    Check if there are new updates for PRIMARY ADMIN files only
// @route   GET /api/excel/vehicles/sync/check-updates-primary
// @access  Private (Admin, Auditor, FieldAgent, SuperAdmin)
router.get('/vehicles/sync/check-updates-primary',
  authenticateToken,
  async (req, res) => {
    try {
      console.log('🔍 Checking PRIMARY admin sync updates for user:', req.user._id, 'role:', req.user.role);

      const userRole = req.user.role;
      let primaryAdminId = null;

      if (userRole === 'admin') {
        primaryAdminId = req.user._id;
      } else if (userRole === 'auditor' || userRole === 'fieldAgent') {
        const userRecord = await User.findById(req.user._id).select('createdBy').lean();
        if (userRecord && userRecord.createdBy) {
          primaryAdminId = userRecord.createdBy;
        }
      } else if (userRole === 'superAdmin' || userRole === 'superSuperAdmin') {
        // SuperAdmin roles: fall back to full update check (all files)
        const allFiles = await ExcelFile.find({ isActive: true })
          .select('updatedAt createdAt')
          .lean();

        if (!allFiles || allFiles.length === 0) {
          return res.json({
            success: true,
            hasUpdates: false,
            latestFileUpdateTime: null,
            accessibleFilesCount: 0,
            message: 'No files found'
          });
        }

        let latestUpdateTime = null;
        for (const file of allFiles) {
          const fileTime = file.updatedAt || file.createdAt;
          if (!fileTime) continue;
          if (!latestUpdateTime || fileTime > latestUpdateTime) {
            latestUpdateTime = fileTime;
          }
        }

        return res.json({
          success: true,
          hasUpdates: latestUpdateTime != null,
          latestFileUpdateTime: latestUpdateTime ? latestUpdateTime.toISOString() : null,
          accessibleFilesCount: allFiles.length
        });
      }

      if (!primaryAdminId) {
        return res.json({
          success: true,
          hasUpdates: false,
          latestFileUpdateTime: null,
          accessibleFilesCount: 0,
          message: 'No primary admin found'
        });
      }

      const primaryAdminIdStr = primaryAdminId.toString();

      const candidateFiles = await ExcelFile.find({
        isActive: true,
        $or: [
          { uploadedBy: primaryAdminId },
          { assignedTo: primaryAdminId }
        ]
      })
      .populate('uploadedBy', 'role')
      .select('uploadedBy assignedTo updatedAt createdAt')
      .lean();

      const extractId = (value) => {
        if (!value) return null;
        if (typeof value === 'string') return value;
        if (value._id) return value._id.toString();
        if (value.toString) return value.toString();
        return null;
      };

      let latestUpdateTime = null;
      let primaryFilesCount = 0;

      for (const file of candidateFiles) {
        const uploaderRole = file.uploadedBy?.role;
        const isSuperAdminUpload = uploaderRole === 'superAdmin' || uploaderRole === 'superSuperAdmin';
        const isAdminUpload = uploaderRole === 'admin';

        let filePrimaryAdminId = null;
        if (isSuperAdminUpload) {
          filePrimaryAdminId = extractId(file.assignedTo);
        } else if (isAdminUpload) {
          filePrimaryAdminId = extractId(file.uploadedBy);
        }

        if (!filePrimaryAdminId || filePrimaryAdminId !== primaryAdminIdStr) {
          continue;
        }

        primaryFilesCount++;
        const fileTime = file.updatedAt || file.createdAt;
        if (fileTime && (!latestUpdateTime || fileTime > latestUpdateTime)) {
          latestUpdateTime = fileTime;
        }
      }

      return res.json({
        success: true,
        hasUpdates: latestUpdateTime != null,
        latestFileUpdateTime: latestUpdateTime ? latestUpdateTime.toISOString() : null,
        accessibleFilesCount: primaryFilesCount
      });
    } catch (error) {
      console.error('❌ Error checking PRIMARY admin sync updates:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to check primary admin sync updates',
        error: error.message
      });
    }
  }
);

// CACHED HELPER FUNCTIONS (much faster with caching)
async function getExcelFileIdsForAdmin(adminId) {
  const cacheKey = `admin_files_${adminId}`;
  const cached = searchCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    console.log(`⚡ Cache hit for admin ${adminId}: ${cached.data.length} files`);
    return cached.data;
  }

  console.log(`🔍 Fetching files for admin ${adminId}...`);
  
  // Get all files admin might have access to
  const allFiles = await ExcelFile.find({
    isActive: true,
    $or: [
      { uploadedBy: adminId }, // Files they own
      { assignedTo: adminId }, // Files assigned to them (SuperAdmin uploads)
      { assignedAdmins: adminId }, // Files they're assigned to (SuperAdmin uploads)
      { sharedAdmins: adminId } // Files shared with them by other admins
    ]
  }).populate('uploadedBy', 'role').lean();
  
  // Filter: Only include files that are:
  // 1. Owned by this admin, OR
  // 2. Uploaded by SuperAdmin (not by other admins), OR
  // 3. Shared with this admin by another admin (sharedAdmins)
  const accessibleFiles = allFiles.filter(file => {
    const isOwner = file.uploadedBy?._id?.toString() === adminId.toString();
    const isSuperAdminUpload = file.uploadedBy?.role === 'superAdmin' || file.uploadedBy?.role === 'superSuperAdmin';
    const isShared = file.sharedAdmins && file.sharedAdmins.some(id => id.toString() === adminId.toString());
    return isOwner || isSuperAdminUpload || isShared;
  });
  
  const fileIds = accessibleFiles.map(file => file._id);
  console.log(`📁 Admin ${adminId} has access to ${fileIds.length} files (filtered from ${allFiles.length}):`, fileIds);
  
  searchCache.set(cacheKey, {
    data: fileIds,
    timestamp: Date.now()
  });
  
  return fileIds;
}

async function getExcelFileIdsForFieldAgent(fieldAgentId) {
  const cacheKey = `field_files_${fieldAgentId}`;
  const cached = searchCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }

  const fieldAgent = await User.findById(fieldAgentId).select('createdBy').lean();
  if (!fieldAgent || !fieldAgent.createdBy) return [];
  
  // Get all files the admin has access to
  const allFiles = await ExcelFile.find({
    isActive: true,
    $or: [
      { uploadedBy: fieldAgent.createdBy },
      { assignedTo: fieldAgent.createdBy },
      { assignedAdmins: fieldAgent.createdBy },
      { sharedAdmins: fieldAgent.createdBy } // Files shared with field agent's admin
    ]
  }).populate('uploadedBy', 'role').lean();
  
  // Filter: Only include files that are:
  // 1. Owned by field agent's admin, OR
  // 2. Uploaded by SuperAdmin (not by other admins), OR
  // 3. Shared with field agent's admin by another admin
  const accessibleFiles = allFiles.filter(file => {
    const isOwnerAdmin = file.uploadedBy?._id?.toString() === fieldAgent.createdBy.toString();
    const isSuperAdminUpload = file.uploadedBy?.role === 'superAdmin' || file.uploadedBy?.role === 'superSuperAdmin';
    const isShared = file.sharedAdmins && file.sharedAdmins.some(id => id.toString() === fieldAgent.createdBy.toString());
    return isOwnerAdmin || isSuperAdminUpload || isShared;
  });
  
  const fileIds = accessibleFiles.map(file => file._id);
  
  searchCache.set(cacheKey, {
    data: fileIds,
    timestamp: Date.now()
  });
  
  return fileIds;
}

async function getExcelFileIdsForAuditor(auditorId) {
  const cacheKey = `auditor_files_${auditorId}`;
  const cached = searchCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }

  const auditor = await User.findById(auditorId).select('createdBy').lean();
  if (!auditor || !auditor.createdBy) return [];
  
  // Get all files the admin has access to
  const allFiles = await ExcelFile.find({
    isActive: true,
    $or: [
      { uploadedBy: auditor.createdBy },
      { assignedTo: auditor.createdBy },
      { assignedAdmins: auditor.createdBy },
      { sharedAdmins: auditor.createdBy } // Files shared with auditor's admin
    ]
  }).populate('uploadedBy', 'role').lean();
  
  // Filter: Only include files that are:
  // 1. Owned by auditor's admin, OR
  // 2. Uploaded by SuperAdmin (not by other admins), OR
  // 3. Shared with auditor's admin by another admin
  const accessibleFiles = allFiles.filter(file => {
    const isOwnerAdmin = file.uploadedBy?._id?.toString() === auditor.createdBy.toString();
    const isSuperAdminUpload = file.uploadedBy?.role === 'superAdmin' || file.uploadedBy?.role === 'superSuperAdmin';
    const isShared = file.sharedAdmins && file.sharedAdmins.some(id => id.toString() === auditor.createdBy.toString());
    return isOwnerAdmin || isSuperAdminUpload || isShared;
  });
  
  const fileIds = accessibleFiles.map(file => file._id);
  
  searchCache.set(cacheKey, {
    data: fileIds,
    timestamp: Date.now()
  });
  
  return fileIds;
}



// @desc    Download Excel template
// @route   GET /api/excel/template
// @access  Private (SuperAdmin, Admin)
router.get('/template',
  authenticateToken,
  authorizeRole('superSuperAdmin', 'superAdmin', 'admin'),
  async (req, res) => {
    try {
      // Create template workbook
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet([EXPECTED_HEADERS]);
      
      // Add sample row
      const sampleRow = EXPECTED_HEADERS.map(() => 'Sample Data');
      XLSX.utils.sheet_add_aoa(worksheet, [sampleRow], { origin: 'A2' });

      // Set column widths
      const colWidths = EXPECTED_HEADERS.map(() => ({ width: 15 }));
      worksheet['!cols'] = colWidths;

      XLSX.utils.book_append_sheet(workbook, worksheet, 'Vehicle Data');

      // Generate buffer
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="vehicle_template.xlsx"');
      res.send(buffer);

    } catch (error) {
      console.error('Template download error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }
  }
);

// @desc    Get vehicle master data by registration number (for money management prefill)
// @route   GET /api/excel/vehicles/by-reg/:registrationNumber
// @access  Private (Admin, Auditor)
router.get('/vehicles/by-reg/:registrationNumber',
  authenticateToken,
  authorizeRole('admin', 'auditor'),
  async (req, res) => {
    try {
      const { registrationNumber } = req.params;
      
      if (!registrationNumber) {
        return res.status(400).json({
          success: false,
          message: 'Registration number is required'
        });
      }

      const startTime = Date.now();
      
      // ✅ PRODUCTION: Use VehicleLookup + GCS only (ExcelVehicle removed)
      let vehicle = null;
      // 🚨 SECURITY: Get accessible file IDs FIRST (security boundary)
      let accessibleFileIds = [];
      if (req.user.role === 'admin') {
        accessibleFileIds = await getExcelFileIdsForAdmin(req.user._id);
      } else if (req.user.role === 'fieldAgent') {
        accessibleFileIds = await getExcelFileIdsForFieldAgent(req.user._id);
      } else if (req.user.role === 'auditor') {
        accessibleFileIds = await getExcelFileIdsForAuditor(req.user._id);
      } else if (req.user.role === 'superAdmin' || req.user.role === 'superSuperAdmin') {
        const allFiles = await ExcelFile.find({ isActive: true }).select('_id').lean();
        accessibleFileIds = allFiles.map(file => file._id);
      }

      if (accessibleFileIds.length === 0) {
        return res.json({
          success: true,
          found: false,
          message: 'Vehicle not found in master data'
        });
      }

      // 🚨 SECURITY: ALWAYS filter VehicleLookup by accessible files
      const mongoose = require('mongoose');
      const accessibleFileObjectIds = accessibleFileIds.map(id => new mongoose.Types.ObjectId(id));
      
      const lookup = await VehicleLookup.findOne({
        registrationNumber: new RegExp(`^${registrationNumber.trim()}$`, 'i'),
        excelFileId: { $in: accessibleFileObjectIds } // ✅ CRITICAL: Security filter
      })
      .lean();

      if (lookup && isGCSConfigured()) {
        // LEVEL 4: Find ExcelFile that contains this vehicle by searching accessible files

        // Get accessible GCS files
        const accessibleFiles = await ExcelFile.find({ 
          _id: { $in: accessibleFileIds },
          isActive: true 
        }).select('filePath').lean();
        
        const accessibleGcsUrls = accessibleFiles
          .map(file => file.filePath)
          .filter(url => url && (url.includes('storage.googleapis.com') || url.includes('gcs')));

        // Search accessible files for matching vehicle
        for (const gcsFileUrl of accessibleGcsUrls) {
          try {
            // Search Excel file for this registration number
            const vehicleDataArray = await searchVehiclesInExcel(gcsFileUrl, [lookup]);
            if (vehicleDataArray && vehicleDataArray[0]) {
              const vehicleData = vehicleDataArray[0];
              vehicle = {
                registration_number: vehicleData.registration_number || lookup.registrationNumber,
                make: vehicleData.make || '',
                model: vehicleData.model || '',
                bank: vehicleData.bank || '',
                customer_name: vehicleData.customer_name || '',
                loan_number: vehicleData.loan_number || '',
                status: vehicleData.status || ''
              };
              break; // Found it, stop searching
            }
          } catch (error) {
            // Continue to next file
            continue;
          }
        }
      }

      // ✅ PRODUCTION: Only VehicleLookup + GCS (ExcelVehicle removed)
      // No legacy fallback - all data must be in VehicleLookup + GCS

      const queryTime = Date.now() - startTime;
      console.log(`🔍 Vehicle lookup for ${registrationNumber}: ${queryTime}ms`);

      if (!vehicle) {
        return res.json({
          success: true,
          found: false,
          message: 'Vehicle not found in master data'
        });
      }

      res.json({
        success: true,
        found: true,
        data: {
          registration_number: vehicle.registration_number || '',
          make: vehicle.make || '',
          model: vehicle.model || '',
          bank: vehicle.bank || '',
          customer_name: vehicle.customer_name || '',
          loan_number: vehicle.loan_number || '',
          status: vehicle.status || ''
        }
      });

    } catch (error) {
      console.error('Error fetching vehicle master data:', error);
      res.status(500).json({
        success: false,
        message: 'Server error while fetching vehicle data'
      });
    }
  }
);

module.exports = router; 
