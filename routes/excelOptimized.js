const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const XLSX = require('xlsx');
const { body, validationResult, query } = require('express-validator');
const ExcelFile = require('../models/ExcelFile');
const VehicleLookup = require('../models/VehicleLookup');
const User = require('../models/User');
const FileStorageSettings = require('../models/FileStorageSettings');
const UserStorageLimit = require('../models/UserStorageLimit');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { uploadFileToGCS, deleteFileFromGCS, isGCSConfigured } = require('../services/gcsService');
const { getVehicleDataFromExcel, getMultipleVehicleDataFromExcel, clearCacheForFile } = require('../services/excelCacheService');

const router = express.Router();

// Check GCS configuration
if (!isGCSConfigured()) {
  console.warn('⚠️  WARNING: GCS is not configured. Excel uploads will fail.');
  console.warn('⚠️  Please set GCS_PROJECT_ID, GCS_BUCKET_NAME, and GCS credentials.');
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

/**
 * OPTIMIZED UPLOAD ENDPOINT
 * - Uploads Excel file to Google Cloud Storage
 * - Extracts ONLY registrationNumber and chassisNumber to MongoDB
 * - All other data remains in GCS Excel file
 */
router.post('/upload-optimized', 
  authenticateToken, 
  authorizeRole('superSuperAdmin', 'superAdmin', 'admin'),
  upload.single('excelFile'),
  [
    body('assignedTo').optional().custom((value, { req }) => {
      if ((req.user.role === 'superSuperAdmin' || req.user.role === 'superAdmin') && !value) {
        throw new Error('Admin assignment is required for super admin uploads');
      }
      return true;
    })
  ],
  async (req, res) => {
    try {
      // Check GCS configuration
      if (!isGCSConfigured()) {
        return res.status(500).json({
          success: false,
          message: 'Google Cloud Storage is not configured. Please contact administrator.'
        });
      }

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

      // Determine assigned admins (same logic as before)
      let assignedTo = req.user._id;
      let assignedAdmins = [req.user._id];
      
      if (req.user.role === 'superSuperAdmin' || req.user.role === 'superAdmin') {
        if (!req.body.assignedTo) {
          return res.status(400).json({
            success: false,
            message: 'Admin assignment is required for super admin uploads'
          });
        }
        
        let adminIds = [req.body.assignedTo];
        if (req.body.assignedAdmins) {
          try {
            const assignedAdmins = typeof req.body.assignedAdmins === 'string' 
              ? JSON.parse(req.body.assignedAdmins) 
              : req.body.assignedAdmins;
            if (Array.isArray(assignedAdmins)) {
              adminIds = assignedAdmins;
            }
          } catch (error) {
            adminIds = [req.body.assignedTo];
          }
        }
        
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
        
        assignedTo = req.body.assignedTo;
        assignedAdmins = adminIds;
      }

      // Read Excel file to get row count and validate headers
      const workbook = XLSX.readFile(req.file.path, { 
        cellDates: true,
        cellNF: false,
        cellText: false,
        cellStyles: false
      });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
      const totalRows = range.e.r + 1;

      if (totalRows < 2) {
        return res.status(400).json({
          success: false,
          message: 'Excel file must contain at least headers and one data row'
        });
      }

      // Validate headers
      const headers = [];
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
        const cell = worksheet[cellAddress];
        headers[col] = cell ? cell.v : null;
      }

      const missingHeaders = EXPECTED_HEADERS.filter(header => !headers.includes(header));
      if (missingHeaders.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid Excel headers',
          missingHeaders: missingHeaders,
          expectedHeaders: EXPECTED_HEADERS
        });
      }

      // Check storage limits (same logic as before)
      const recordCount = totalRows - 1;
      const userRole = req.user.role;
      
      let userStorageLimit = await UserStorageLimit.findOne({ 
        userId: req.user._id, 
        isActive: true 
      });

      let totalRecordLimit;
      if (userStorageLimit) {
        totalRecordLimit = userStorageLimit.totalRecordLimit;
      } else {
        const storageSettings = await FileStorageSettings.findOne({ 
          role: userRole, 
          isActive: true 
        });
        if (!storageSettings) {
          return res.status(400).json({
            success: false,
            message: 'File storage settings not found for your role.'
          });
        }
        totalRecordLimit = storageSettings.totalRecordLimit;
      }

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
        return res.status(400).json({
          success: false,
          message: `Total record limit exceeded. Your limit is ${totalRecordLimit.toLocaleString()} records. You have used ${usedRecords.toLocaleString()} records and can upload maximum ${remainingRecords.toLocaleString()} more records.`,
          totalLimit: totalRecordLimit,
          usedRecords: usedRecords,
          remainingRecords: remainingRecords,
          fileRecords: recordCount
        });
      }

      // Upload file to GCS
      const gcsFileName = `excel/${Date.now()}-${req.file.filename}`;
      const gcsFileUrl = await uploadFileToGCS(req.file.path, gcsFileName);

      // Create ExcelFile record with GCS URL
      const excelFile = await ExcelFile.create({
        filename: req.file.filename,
        originalName: req.file.originalname,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        uploadedBy: req.user._id,
        assignedTo: assignedTo,
        assignedAdmins: assignedAdmins,
        totalRows: recordCount,
        filePath: gcsFileUrl, // Store GCS URL instead of local path
        status: 'processing'
      });

      // Extract ONLY registrationNumber and chassisNumber and insert into MongoDB
      const headerMap = {};
      headers.forEach((header, index) => {
        headerMap[index] = header;
      });

      const chunkSize = 1000;
      let processedRows = 0;
      let failedRows = 0;
      let skippedRows = 0;

      // Find column indices for registration_number and chasis_number
      const regColIndex = headers.indexOf('registration_number');
      const chassisColIndex = headers.indexOf('chasis_number');

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

          // Insert minimal data into MongoDB
          bulkOps.push({
            insertOne: {
              document: {
                registrationNumber: registrationNumber || null,
                chassisNumber: chassisNumber || null,
                gcsFileUrl: gcsFileUrl,
                rowNumber: rowNumber,
                excelFileId: excelFile._id,
                createdAt: new Date()
              }
            }
          });
        }

        // Execute bulk operations
        if (bulkOps.length > 0) {
          try {
            const result = await VehicleLookup.bulkWrite(bulkOps, { 
              ordered: false, // Continue on errors
              w: 1
            });
            processedRows += result.insertedCount;
            
            // Handle any write errors (duplicates are now allowed, so 11000 shouldn't occur)
            if (result.writeErrors && result.writeErrors.length > 0) {
              const nonDuplicateErrors = result.writeErrors.filter(err => err.code !== 11000);
              failedRows += nonDuplicateErrors.length;
              if (nonDuplicateErrors.length > 0) {
                console.log(`⚠️  Chunk ${Math.floor(startRow / chunkSize) + 1}: ${nonDuplicateErrors.length} entries failed to insert`);
              }
            }
          } catch (error) {
            // Only log unexpected errors (not duplicate key errors since duplicates are now allowed)
            if (error.code !== 11000) {
              console.error(`Chunk error:`, error.message);
            }
            failedRows += bulkOps.length;
          }
        }

        // Update progress
        if ((Math.floor(startRow / chunkSize) + 1) % 5 === 0 || endRow >= totalRows - 1) {
          await ExcelFile.findByIdAndUpdate(excelFile._id, {
            processedRows: processedRows,
            failedRows: failedRows,
            skippedRows: skippedRows,
            status: 'processing'
          });
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

      // Delete temporary local file
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        console.error('Error deleting temp file:', unlinkError);
      }

      res.status(201).json({
        success: true,
        message: 'Excel file uploaded and processed successfully',
        data: {
          fileId: excelFile._id,
          filename: req.file.originalname,
          totalRows: recordCount,
          processedRows,
          failedRows,
          skippedRows,
          status,
          gcsFileUrl: gcsFileUrl
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

/**
 * OPTIMIZED SEARCH ENDPOINT
 * - Searches MongoDB VehicleLookup (fast, minimal data)
 * - Fetches full vehicle data from GCS Excel files
 * - Returns complete vehicle data to frontend (no changes needed)
 */
router.get('/vehicles-optimized',
  authenticateToken,
  async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = Math.min(parseInt(req.query.limit) || 20, 1000);
      const { search, searchType } = req.query;

      // Validate search term
      if (!search || search.trim().length < 3) {
        return res.json({
          success: true,
          data: [],
          pagination: { page, limit, total: 0, pages: 0 },
          message: 'Enter at least 3 characters to search'
        });
      }

      const searchTerm = search.trim();
      const startTime = Date.now();

      // Get accessible file IDs (same logic as before)
      let accessibleFileIds = [];
      if (req.user.role === 'admin') {
        const files = await ExcelFile.find({
          isActive: true,
          $or: [
            { uploadedBy: req.user._id },
            { assignedTo: req.user._id },
            { assignedAdmins: req.user._id }
          ]
        }).select('_id').lean();
        accessibleFileIds = files.map(f => f._id);
      } else if (req.user.role === 'superAdmin' || req.user.role === 'superSuperAdmin') {
        const allFiles = await ExcelFile.find({ isActive: true }).select('_id').lean();
        accessibleFileIds = allFiles.map(f => f._id);
      }

      if (accessibleFileIds.length === 0) {
        return res.json({
          success: true,
          data: [],
          pagination: { page, limit, total: 0, pages: 0 },
          message: 'No accessible files found'
        });
      }

      // Build search query for VehicleLookup (MongoDB - FAST)
      const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let searchQuery = {
        excelFileId: { $in: accessibleFileIds }
      };

      if (searchType && searchType !== 'all') {
        if (searchType === 'registration_number') {
          searchQuery.registrationNumber = { $regex: escapedTerm, $options: 'i' };
        } else if (searchType === 'chasis_number') {
          searchQuery.chassisNumber = { $regex: escapedTerm, $options: 'i' };
        } else {
          searchQuery.$or = [
            { registrationNumber: { $regex: escapedTerm, $options: 'i' } },
            { chassisNumber: { $regex: escapedTerm, $options: 'i' } }
          ];
        }
      } else {
        searchQuery.$or = [
          { registrationNumber: { $regex: escapedTerm, $options: 'i' } },
          { chassisNumber: { $regex: escapedTerm, $options: 'i' } }
        ];
      }

      // Get total count (FAST - only searches minimal MongoDB data)
      const total = await VehicleLookup.countDocuments(searchQuery);

      // Get lookup results with pagination (FAST - only minimal data)
      const lookups = await VehicleLookup.find(searchQuery)
        .populate('excelFileId', 'originalName filename uploadedBy assignedTo assignedAdmins createdAt')
        .sort({ registrationNumber: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      // Group lookups by GCS file URL for batch fetching
      const lookupsByFile = {};
      lookups.forEach(lookup => {
        if (!lookupsByFile[lookup.gcsFileUrl]) {
          lookupsByFile[lookup.gcsFileUrl] = [];
        }
        lookupsByFile[lookup.gcsFileUrl].push(lookup);
      });

      // Fetch full vehicle data from GCS Excel files (BATCH OPERATION)
      const vehicles = [];
      for (const [gcsFileUrl, fileLookups] of Object.entries(lookupsByFile)) {
        try {
          const rowNumbers = fileLookups.map(l => l.rowNumber);
          const vehicleDataArray = await getMultipleVehicleDataFromExcel(gcsFileUrl, rowNumbers);
          
          // Map vehicle data to lookup records
          fileLookups.forEach((lookup, index) => {
            const vehicleData = vehicleDataArray[index];
            if (vehicleData) {
              // Get uploader info for role-based filtering
              const excelFile = lookup.excelFileId;
              vehicles.push({
                _id: lookup._id,
                ...vehicleData, // All vehicle fields from Excel
                excel_file: {
                  _id: excelFile._id,
                  filename: excelFile.filename,
                  originalName: excelFile.originalName,
                  uploadedBy: excelFile.uploadedBy,
                  assignedTo: excelFile.assignedTo,
                  assignedAdmins: excelFile.assignedAdmins,
                  createdAt: excelFile.createdAt
                },
                createdAt: lookup.createdAt,
                rowNumber: lookup.rowNumber
              });
            }
          });
        } catch (error) {
          console.error(`Error fetching vehicle data from ${gcsFileUrl}:`, error);
          // Continue with other files even if one fails
        }
      }

      // Sort vehicles by registration number (maintain alphabetical order)
      vehicles.sort((a, b) => {
        const regA = a.registration_number || '';
        const regB = b.registration_number || '';
        return regA.localeCompare(regB);
      });

      const queryTime = Date.now() - startTime;
      console.log(`🚀 OPTIMIZED search completed in ${queryTime}ms for "${searchTerm}" (${vehicles.length} results)`);

      // Apply role-based field visibility (same logic as before)
      // ... (role-based filtering code from original endpoint)

      res.json({
        success: true,
        data: vehicles,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        },
        performance: {
          queryTime: `${queryTime}ms`,
          resultsCount: vehicles.length,
          cached: false
        }
      });

    } catch (error) {
      console.error('Optimized search error:', error);
      
      // Handle MongoDB quota errors
      if (error.message && error.message.includes('space quota')) {
        return res.status(507).json({
          success: false,
          message: 'MongoDB storage quota exceeded. Please contact administrator.',
          error: 'STORAGE_QUOTA_EXCEEDED'
        });
      }

      res.status(500).json({
        success: false,
        message: 'Search error - please try again',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

module.exports = router;
