const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const XLSX = require('xlsx');
const { body, validationResult, query } = require('express-validator');
const ExcelFile = require('../models/ExcelFile');
const ExcelVehicle = require('../models/ExcelVehicle');
const User = require('../models/User');
const FileStorageSettings = require('../models/FileStorageSettings');
const UserStorageLimit = require('../models/UserStorageLimit');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/excel');
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

      // Create ExcelFile record
      const excelFile = await ExcelFile.create({
        filename: req.file.filename,
        originalName: req.file.originalname,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        uploadedBy: req.user._id,
        assignedTo: assignedTo,
        assignedAdmins: assignedAdmins,
        totalRows: recordCount,
        filePath: req.file.path
      });

      // Process data rows in streaming chunks
      const chunkSize = 1000; // Process 1000 rows at a time
      let processedRows = 0;
      let failedRows = 0;
      let skippedRows = 0;

      // Create header mapping
      const headerMap = {};
      headers.forEach((header, index) => {
        headerMap[index] = header;
      });

      // Process rows in chunks to prevent memory issues
      for (let startRow = 1; startRow < totalRows; startRow += chunkSize) {
        const endRow = Math.min(startRow + chunkSize - 1, totalRows - 1);
        
        // Read chunk of rows
        const chunkData = [];
        for (let row = startRow; row <= endRow; row++) {
          const rowData = [];
          for (let col = range.s.c; col <= range.e.c; col++) {
            const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
            const cell = worksheet[cellAddress];
            rowData[col] = cell ? cell.v : null;
          }
          chunkData.push(rowData);
        }

        // Process this chunk
        const bulkOps = [];
        
        chunkData.forEach((row, chunkIndex) => {
          const rowNumber = startRow + chunkIndex + 1; // +1 because we start from row 2 (after header)
          
          // Skip empty rows
          if (!row || row.every(cell => !cell || cell.toString().trim() === '')) {
            skippedRows++;
            return;
          }

          const vehicleRecord = {
            insertOne: {
              document: {
                excel_file: excelFile._id,
                rowNumber: rowNumber
              }
            }
          };

          // Map data to fields
          Object.keys(headerMap).forEach(columnIndex => {
            const fieldName = headerMap[columnIndex];
            const value = row[columnIndex];
            vehicleRecord.insertOne.document[fieldName] = value ? value.toString().trim() : null;
          });

          bulkOps.push(vehicleRecord);
        });

        // Execute bulk operations for this chunk
        if (bulkOps.length > 0) {
          try {
            const result = await ExcelVehicle.bulkWrite(bulkOps, { 
              ordered: false,
              w: 1 // Write concern
            });
            processedRows += result.insertedCount;
          } catch (error) {
            console.error(`Chunk ${Math.floor(startRow / chunkSize) + 1} error:`, error.message);
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
        message: 'Excel file uploaded and processed successfully',
        data: {
          fileId: excelFile._id,
          filename: req.file.originalname,
          totalRows: recordCount,
          processedRows,
          failedRows,
          skippedRows,
          status
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

      res.status(500).json({
        success: false,
        message: 'Server error during file upload'
      });
    }
  }
);

// Function to mask filename for admin users when file is uploaded by SuperAdmin
const maskFilename = (originalName, uploadedByRole, currentUserRole) => {
  if (currentUserRole === 'admin' && (uploadedByRole === 'superAdmin' || uploadedByRole === 'superSuperAdmin')) {
    // Generate a masked filename using the original name's hash
    const hash = require('crypto').createHash('md5').update(originalName).digest('hex').substring(0, 8);
    const extension = originalName.split('.').pop();
    return `FILE_${hash.toUpperCase()}.${extension}`;
  }
  return originalName;
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
              $or: [
                { uploadedBy: req.user._id },
                { assignedTo: req.user._id },
                { assignedAdmins: req.user._id }
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
            assignedAdmins: '$assignedAdminsUsers'
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

      // Mask filenames for admin users when files are uploaded by SuperAdmin
      const maskedFiles = files.map(file => {
        const maskedOriginalName = maskFilename(
          file.originalName, 
          file.uploadedBy?.role, 
          req.user.role
        );
        
        return {
          ...file,
          originalName: maskedOriginalName,
          // Also mask the filename field for consistency
          filename: file.uploadedBy?.role === 'superAdmin' || file.uploadedBy?.role === 'superSuperAdmin' 
            ? `FILE_${file._id.toString().substring(0, 8).toUpperCase()}.xlsx`
            : file.filename
        };
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
      if (req.user.role === 'admin' && 
          excelFile.uploadedBy._id.toString() !== req.user._id.toString() &&
          excelFile.assignedTo._id.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      res.json({
        success: true,
        data: excelFile
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
      const excelFile = await ExcelFile.findById(req.params.id);

      if (!excelFile) {
        return res.status(404).json({
          success: false,
          message: 'Excel file not found'
        });
      }

      // Check access permissions
      if (req.user.role === 'admin' && 
          excelFile.uploadedBy.toString() !== req.user._id.toString() &&
          excelFile.assignedTo.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      // Delete all related vehicle data
      const deleteResult = await ExcelVehicle.deleteMany({ excel_file: excelFile._id });
      console.log(`🗑️ Deleted ${deleteResult.deletedCount} vehicle records for file ${excelFile._id}`);

      // Delete physical file
      try {
        await fs.unlink(excelFile.filePath);
      } catch (unlinkError) {
        console.error('Error deleting physical file:', unlinkError);
      }

      // Delete ExcelFile record
      await ExcelFile.findByIdAndDelete(excelFile._id);

      // Clear search cache to ensure deleted data is not cached
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
        message: 'Excel file and all related data deleted successfully'
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

      // Verify all assigned admins exist and are active
      const assignedAdminUsers = await User.find({
        _id: { $in: assignedAdmins },
        role: 'admin',
        isActive: true
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
      
      // Get total vehicle count
      const totalVehicles = await ExcelVehicle.countDocuments({ isActive: true });
      
      // Get vehicles for accessible files
      const accessibleVehicles = await ExcelVehicle.countDocuments({
        isActive: true,
        excel_file: { $in: accessibleFileIds }
      });

      // Check for orphaned vehicle records
      const orphanedVehicles = await ExcelVehicle.aggregate([
        { $match: { isActive: true } },
        {
          $lookup: {
            from: 'excelfiles',
            localField: 'excel_file',
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

// @desc    Clean up orphaned vehicle records (remove in production)
// @route   POST /api/excel/cleanup-orphaned-vehicles
// @access  Private (SuperAdmin, Admin)
router.post('/cleanup-orphaned-vehicles',
  authenticateToken,
  authorizeRole('superSuperAdmin', 'superAdmin', 'admin'),
  async (req, res) => {
    try {
      console.log('🧹 Starting orphaned vehicle cleanup...');
      
      // Find orphaned vehicle records
      const orphanedVehicles = await ExcelVehicle.aggregate([
        { $match: { isActive: true } },
        {
          $lookup: {
            from: 'excelfiles',
            localField: 'excel_file',
            foreignField: '_id',
            as: 'fileCheck'
          }
        },
        { $match: { 'fileCheck.0': { $exists: false } } },
        { $project: { _id: 1, excel_file: 1 } }
      ]);

      console.log(`🔍 Found ${orphanedVehicles.length} orphaned vehicle records`);

      if (orphanedVehicles.length > 0) {
        const orphanedIds = orphanedVehicles.map(v => v._id);
        const deleteResult = await ExcelVehicle.deleteMany({ _id: { $in: orphanedIds } });
        console.log(`🗑️ Deleted ${deleteResult.deletedCount} orphaned vehicle records`);
      }

      res.json({
        success: true,
        message: `Cleaned up ${orphanedVehicles.length} orphaned vehicle records`,
        deletedCount: orphanedVehicles.length
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

// @desc    ULTRA-FAST vehicle search - only 3 key fields
// @route   GET /api/excel/vehicles  
// @access  Private (All roles)
router.get('/vehicles',
  authenticateToken,
  async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = Math.min(parseInt(req.query.limit) || 20, 1000); // Allow up to 1000 results for complete search
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
      const cacheKey = `${req.user._id}-${searchTerm.toLowerCase()}-${searchType}-${page}-alphabetical`;
      
      // Check cache first (INSTANT response for cached partial-match searches)
      const cached = searchCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        console.log(`⚡ Cache hit for alphabetical search: "${searchTerm}" (0ms)`);
        return res.json(cached.data);
      }

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

      console.log(`🔍 User ${req.user._id} (${req.user.role}) has ${accessibleFileIds.length} accessible files:`, accessibleFileIds);

      // Build base query with file existence check
      const baseQuery = {
        isActive: true
      };

      // Add role-based file access restrictions for all roles
      if (accessibleFileIds.length > 0) {
        baseQuery.excel_file = { $in: accessibleFileIds };
      } else {
        // If no accessible files, return empty results
        console.log(`❌ No accessible files found for user ${req.user._id} (${req.user.role})`);
        return res.json({
          success: true,
          data: [],
          pagination: { page, limit, total: 0, pages: 0 },
          message: 'No accessible files found'
        });
      }

      // SMART SEARCH STRATEGY - ANYWHERE IN STRING (supports partial matches)
      let searchQuery;
      
      // Escape special regex characters for safety
      const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      if (searchType && searchType !== 'all') {
        // Specific field search (matches anywhere in the field)
        if (['registration_number', 'chasis_number', 'engine_number'].includes(searchType)) {
          searchQuery = {
            ...baseQuery,
            [searchType]: { $regex: escapedTerm, $options: 'i' } // Matches anywhere in string
          };
        } else {
          // Fallback for any other searchType
          searchQuery = {
            ...baseQuery,
            $or: [
              { registration_number: { $regex: escapedTerm, $options: 'i' } },
              { chasis_number: { $regex: escapedTerm, $options: 'i' } },
              { engine_number: { $regex: escapedTerm, $options: 'i' } }
            ]
          };
        }
      } else {
        // Multi-field search (ANYWHERE in 3 fields for maximum flexibility)
        searchQuery = {
          ...baseQuery,
          $or: [
            { registration_number: { $regex: escapedTerm, $options: 'i' } },
            { chasis_number: { $regex: escapedTerm, $options: 'i' } },
            { engine_number: { $regex: escapedTerm, $options: 'i' } }
          ]
        };
      }

      // PERFORMANCE MONITORING
      const startTime = Date.now();
      
      // Execute queries with file existence verification using aggregation
      const [total, vehicles] = await Promise.all([
        // Count total with file existence check
        ExcelVehicle.aggregate([
          { $match: searchQuery },
          {
            $lookup: {
              from: 'excelfiles',
              localField: 'excel_file',
              foreignField: '_id',
              as: 'fileCheck'
            }
          },
          { $match: { 'fileCheck.0': { $exists: true } } },
          { $count: 'total' }
        ]).then(result => result[0]?.total || 0),
        
        // Get vehicles with file existence check
        ExcelVehicle.aggregate([
          { $match: searchQuery },
          {
            $lookup: {
              from: 'excelfiles',
              localField: 'excel_file',
              foreignField: '_id',
              as: 'excel_file'
            }
          },
          { $match: { 'excel_file.0': { $exists: true } } },
          { $unwind: '$excel_file' },
          {
            $lookup: {
              from: 'users',
              localField: 'excel_file.uploadedBy',
              foreignField: '_id',
              as: 'uploader'
            }
          },
          { $unwind: '$uploader' },
          {
            $project: {
              _id: 1,
              registration_number: 1,
              chasis_number: 1,
              engine_number: 1,
              customer_name: 1,
              branch: 1,
              excel_file: 1,
              createdAt: 1,
              rowNumber: 1,
              loan_number: 1,
              make: 1,
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
              third_confirmer_no: 1,
              uploaderRole: '$uploader.role',
              uploaderName: '$uploader.name'
            }
          },
          { $sort: { registration_number: 1 } }, // Sort alphabetically by registration number
          { $skip: (page - 1) * limit },
          { $limit: limit }
        ])
      ]);

      const queryTime = Date.now() - startTime;
      console.log(`🚀 ALPHABETICAL search completed in ${queryTime}ms for "${searchTerm}" (${vehicles.length} results) - sorted A-Z by registration number`);

      // Apply role-based field visibility filtering
      const filteredVehicles = vehicles.map(vehicle => {
        const uploaderRole = vehicle.uploaderRole;
        const userRole = req.user.role;
        
        // Determine data type label based on uploader and current user
        let dataType;
        if (uploaderRole === 'superAdmin' || uploaderRole === 'superSuperAdmin') {
          dataType = 'SUPER ADMIN DATA';
        } else if (uploaderRole === 'admin') {
          // Show the actual file owner's name (uploaderName), not the current user's name
          dataType = `${vehicle.uploaderName?.toUpperCase() || 'ADMIN'} DATA`;
        } else {
          dataType = 'SELF DATA';
        }

        // Debug data type determination
        console.log('🔍 Data Type Debug:', {
          uploaderRole,
          userRole,
          uploaderName: vehicle.uploaderName,
          uploadedBy: vehicle.excel_file.uploadedBy,
          currentUserId: req.user._id.toString(),
          isOwner: vehicle.excel_file.uploadedBy === req.user._id.toString(),
          dataType
        });

        // Mask excel_file name for admin users when file is uploaded by SuperAdmin
        let maskedExcelFile = vehicle.excel_file;
        if (userRole === 'admin' && (uploaderRole === 'superAdmin' || uploaderRole === 'superSuperAdmin')) {
          maskedExcelFile = {
            ...vehicle.excel_file,
            originalName: maskFilename(
              vehicle.excel_file.originalName,
              uploaderRole,
              userRole
            ),
            filename: `FILE_${vehicle.excel_file._id.toString().substring(0, 8).toUpperCase()}.xlsx`
          };
        }

        // Base fields that are always visible
        const baseFields = {
          _id: vehicle._id,
          registration_number: vehicle.registration_number,
          chasis_number: vehicle.chasis_number,
          engine_number: vehicle.engine_number,
          customer_name: vehicle.customer_name,
          make: vehicle.make,
          excel_file: maskedExcelFile,
          createdAt: vehicle.createdAt,
          rowNumber: vehicle.rowNumber,
          dataType: dataType
        };

        // All fields for full access
        const allFields = {
          ...baseFields,
          branch: vehicle.branch,
          loan_number: vehicle.loan_number,
          model: vehicle.model,
          emi: vehicle.emi,
          pos: vehicle.pos,
          bucket: vehicle.bucket,
          address: vehicle.address,
          sec_17: vehicle.sec_17,
          seasoning: vehicle.seasoning,
          allocation: vehicle.allocation,
          product_name: vehicle.product_name,
          first_confirmer_name: vehicle.first_confirmer_name,
          first_confirmer_no: vehicle.first_confirmer_no,
          second_confirmer_name: vehicle.second_confirmer_name,
          second_confirmer_no: vehicle.second_confirmer_no,
          third_confirmer_name: vehicle.third_confirmer_name,
          third_confirmer_no: vehicle.third_confirmer_no
        };

        // Apply field visibility rules
        if (uploaderRole === 'superAdmin' || uploaderRole === 'superSuperAdmin') {
          // SuperAdmin uploaded files
          if (userRole === 'superAdmin' || userRole === 'superSuperAdmin') {
            return allFields; // SuperAdmin can see all fields of SuperAdmin files
          } else if (userRole === 'admin') {
            // Check if this admin is the primary admin (assignedTo) of this file
            const isPrimaryAdmin = vehicle.excel_file.assignedTo?.toString() === req.user._id.toString();
            console.log('🔍 ADMIN ACCESS CHECK:', {
              adminId: req.user._id.toString(),
              assignedTo: vehicle.excel_file.assignedTo?.toString(),
              isPrimaryAdmin,
              returning: isPrimaryAdmin ? 'ALL FIELDS' : 'BASE FIELDS'
            });
            if (isPrimaryAdmin) {
              return allFields; // Primary admin can see all fields including file name
            } else {
              return baseFields; // Non-primary admin sees limited fields
            }
          } else if (userRole === 'auditor') {
            // Check if this auditor's admin is the primary admin (assignedTo) of this file
            if (vehicle.excel_file.assignedTo?.toString() === req.user.createdBy?.toString()) {
              return allFields; // Auditor of primary admin can see all fields
            } else {
              return baseFields; // Other auditors see limited fields
            }
          } else {
            return baseFields; // Others see limited fields
          }
        } else if (uploaderRole === 'admin') {
          // Admin uploaded files
          if (userRole === 'superAdmin' || userRole === 'superSuperAdmin') {
            return allFields; // SuperAdmin can see ALL fields of admin files (no restrictions)
          } else if (userRole === 'admin') {
            // Check if this admin is the original uploader (owner)
            const uploadedById = vehicle.excel_file.uploadedBy;
            const currentUserId = req.user._id.toString();
            const isOwner = uploadedById.toString() === currentUserId;
            
            console.log('🔍 OWNERSHIP CHECK:', {
              uploadedById,
              currentUserId,
              isOwner,
              uploadedByIdType: typeof uploadedById,
              currentUserIdType: typeof currentUserId,
              exactMatch: uploadedById === currentUserId
            });
            
            if (isOwner) {
              console.log('✅ OWNER ACCESS GRANTED - returning all fields');
              return allFields; // Owner can see all fields including file name
            } else {
              console.log('❌ NON-OWNER ACCESS - returning restricted fields');
              // Non-owner admin sees restricted fields without file name
              const restrictedFields = {
                ...baseFields,
                excel_file: {
                  _id: vehicle.excel_file._id,
                  // Don't include originalName or filename for non-owners
                }
              };
              return restrictedFields;
            }
          } else if (userRole === 'auditor') {
            // Check if this auditor's admin is the original uploader (owner)
            const auditorAdminId = req.user.createdBy?.toString();
            const fileUploaderId = vehicle.excel_file.uploadedBy?.toString();
            const isOwnerAuditor = auditorAdminId === fileUploaderId;
            
            console.log('🔍 AUDITOR ACCESS CHECK:', {
              auditorAdminId,
              fileUploaderId,
              isOwnerAuditor,
              auditorAdminIdType: typeof auditorAdminId,
              fileUploaderIdType: typeof fileUploaderId,
              exactMatch: auditorAdminId === fileUploaderId
            });
            
            if (isOwnerAuditor) {
              console.log('✅ OWNER AUDITOR ACCESS GRANTED - returning all fields');
              return allFields; // Auditor of owner can see all fields
            } else {
              console.log('❌ NON-OWNER AUDITOR ACCESS - returning restricted fields');
              // Auditor of non-owner sees restricted fields without file name
              const restrictedFields = {
                ...baseFields,
                excel_file: {
                  _id: vehicle.excel_file._id,
                  // Don't include originalName or filename for non-owners' auditors
                }
              };
              return restrictedFields;
            }
          } else if (userRole === 'fieldAgent') {
            // Field agents always see restricted fields without file name
            const restrictedFields = {
              ...baseFields,
              excel_file: {
                _id: vehicle.excel_file._id,
                // Don't include originalName or filename for field agents
              }
            };
            return restrictedFields;
          }
        }

        // Default fallback
        return baseFields;
      });

      // Prepare response with performance metrics
      const response = {
        success: true,
        data: filteredVehicles,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        },
        performance: {
          queryTime: `${queryTime}ms`,
          resultsCount: filteredVehicles.length,
          cached: false,
          searchType: searchType === 'all' ? 'multi-field' : searchType,
          partialMatch: true,
          sortedBy: 'registration_number_alphabetical'
        }
      };

      // Cache the result (next identical search will be INSTANT)
      searchCache.set(cacheKey, {
        data: { ...response, performance: { ...response.performance, cached: true } },
        timestamp: Date.now()
      });

      // Cleanup old cache entries (prevent memory leaks)
      if (searchCache.size > 1000) {
        const cutoffTime = Date.now() - CACHE_TTL;
        for (const [key, value] of searchCache.entries()) {
          if (value.timestamp < cutoffTime) {
            searchCache.delete(key);
          }
        }
      }

      res.json(response);

    } catch (error) {
      console.error('🔥 ULTRA-FAST search error:', error);
      res.status(500).json({
        success: false,
        message: 'Search error - please try again',
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
      const limit = Math.min(parseInt(req.query.limit) || 100, 500); // Limit to prevent memory issues

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

      // Get total count for pagination with file existence check
      const totalCount = await ExcelVehicle.aggregate([
        { $match: baseQuery },
        {
          $lookup: {
            from: 'excelfiles',
            localField: 'excel_file',
            foreignField: '_id',
            as: 'fileCheck'
          }
        },
        { $match: { 'fileCheck.0': { $exists: true } } },
        { $count: 'total' }
      ]).then(result => result[0]?.total || 0);
      
      console.log(`📊 Total vehicles available: ${totalCount}`);

      // Get vehicles with pagination and file existence check
      const vehicles = await ExcelVehicle.aggregate([
        { $match: baseQuery },
        {
          $lookup: {
            from: 'excelfiles',
            localField: 'excel_file',
            foreignField: '_id',
            as: 'excel_file'
          }
        },
        { $match: { 'excel_file.0': { $exists: true } } },
        { $unwind: '$excel_file' },
        {
          $lookup: {
            from: 'users',
            localField: 'excel_file.uploadedBy',
            foreignField: '_id',
            as: 'uploader'
          }
        },
        { $unwind: '$uploader' },
        {
          $project: {
            registration_number: 1,
            chasis_number: 1,
            engine_number: 1,
            customer_name: 1,
            customer_phone: 1,
            customer_email: 1,
            address: 1,
            branch: 1,
            excel_file: 1,
            createdAt: 1,
            rowNumber: 1,
            loan_number: 1,
            make: 1,
            model: 1,
            emi: 1,
            pos: 1,
            bucket: 1,
            sec_17: 1,
            seasoning: 1,
            allocation: 1,
            product_name: 1,
            first_confirmer_name: 1,
            first_confirmer_no: 1,
            second_confirmer_name: 1,
            second_confirmer_no: 1,
            third_confirmer_name: 1,
            third_confirmer_no: 1,
            assigned_to: 1,
            file_name: 1,
            uploaderRole: '$uploader.role',
            uploaderName: '$uploader.name'
          }
        },
        { $sort: { registration_number: 1 } }, // Sort alphabetically by registration number
        { $skip: (page - 1) * limit },
        { $limit: limit }
      ]);

      console.log(`✅ Found ${vehicles.length} vehicles for offline sync (page ${page}, limit ${limit})`);

      // Apply role-based field visibility filtering for sync
      const filteredVehicles = vehicles.map(vehicle => {
        const uploaderRole = vehicle.uploaderRole;
        const userRole = req.user.role;
        
        // Determine data type label based on uploader and current user
        let dataType;
        if (uploaderRole === 'superAdmin' || uploaderRole === 'superSuperAdmin') {
          dataType = 'SUPER ADMIN DATA';
        } else if (uploaderRole === 'admin') {
          if (userRole === 'admin' && vehicle.excel_file.uploadedBy === req.user._id.toString()) {
            dataType = 'SELF DATA'; // Admin viewing their own uploaded file
          } else {
            // SuperAdmin viewing admin's file - show admin's name
            if (userRole === 'superAdmin' || userRole === 'superSuperAdmin') {
              dataType = `${vehicle.uploaderName?.toUpperCase() || 'ADMIN'} DATA`;
            } else {
              dataType = 'ADMIN DATA'; // Other admin viewing admin's file
            }
          }
        } else {
          dataType = 'SELF DATA';
        }

        // Mask excel_file name for admin users when file is uploaded by SuperAdmin
        let maskedExcelFile = vehicle.excel_file;
        if (userRole === 'admin' && (uploaderRole === 'superAdmin' || uploaderRole === 'superSuperAdmin')) {
          maskedExcelFile = {
            ...vehicle.excel_file,
            originalName: maskFilename(
              vehicle.excel_file.originalName,
              uploaderRole,
              userRole
            ),
            filename: `FILE_${vehicle.excel_file._id.toString().substring(0, 8).toUpperCase()}.xlsx`
          };
        }

        // Base fields that are always visible
        const baseFields = {
          registration_number: vehicle.registration_number,
          chasis_number: vehicle.chasis_number,
          engine_number: vehicle.engine_number,
          customer_name: vehicle.customer_name,
          make: vehicle.make,
          excel_file: maskedExcelFile,
          createdAt: vehicle.createdAt,
          rowNumber: vehicle.rowNumber,
          dataType: dataType
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
          file_name: vehicle.file_name
        };

        // Apply field visibility rules
        if (uploaderRole === 'superAdmin' || uploaderRole === 'superSuperAdmin') {
          // SuperAdmin uploaded files
          if (userRole === 'superAdmin' || userRole === 'superSuperAdmin') {
            return allFields; // SuperAdmin can see all fields of SuperAdmin files
          } else if (userRole === 'admin') {
            // Check if this admin is the primary admin (assignedTo) of this file
            const isPrimaryAdmin = vehicle.excel_file.assignedTo?.toString() === req.user._id.toString();
            console.log('🔍 ADMIN ACCESS CHECK:', {
              adminId: req.user._id.toString(),
              assignedTo: vehicle.excel_file.assignedTo?.toString(),
              isPrimaryAdmin,
              returning: isPrimaryAdmin ? 'ALL FIELDS' : 'BASE FIELDS'
            });
            if (isPrimaryAdmin) {
              return allFields; // Primary admin can see all fields including file name
            } else {
              return baseFields; // Non-primary admin sees limited fields
            }
          } else if (userRole === 'auditor') {
            // Check if this auditor's admin is the primary admin (assignedTo) of this file
            if (vehicle.excel_file.assignedTo?.toString() === req.user.createdBy?.toString()) {
              return allFields; // Auditor of primary admin can see all fields
            } else {
              return baseFields; // Other auditors see limited fields
            }
          } else {
            return baseFields; // Others see limited fields
          }
        } else if (uploaderRole === 'admin') {
          // Admin uploaded files
          if (userRole === 'superAdmin' || userRole === 'superSuperAdmin') {
            return allFields; // SuperAdmin can see ALL fields of admin files (no restrictions)
          } else if (userRole === 'admin') {
            // Check if this admin is the original uploader (owner)
            if (vehicle.excel_file.uploadedBy === req.user._id.toString()) {
              return allFields; // Owner can see all fields including file name
            } else {
              // Non-owner admin sees restricted fields without file name
              const restrictedFields = {
                ...baseFields,
                excel_file: {
                  _id: vehicle.excel_file._id,
                  // Don't include originalName or filename for non-owners
                }
              };
              return restrictedFields;
            }
          } else if (userRole === 'auditor') {
            // Check if this auditor's admin is the original uploader (owner)
            const auditorAdminId = req.user.createdBy?.toString();
            const fileUploaderId = vehicle.excel_file.uploadedBy?.toString();
            const isOwnerAuditor = auditorAdminId === fileUploaderId;
            
            console.log('🔍 AUDITOR ACCESS CHECK (SYNC):', {
              auditorAdminId,
              fileUploaderId,
              isOwnerAuditor,
              auditorAdminIdType: typeof auditorAdminId,
              fileUploaderIdType: typeof fileUploaderId,
              exactMatch: auditorAdminId === fileUploaderId
            });
            
            if (isOwnerAuditor) {
              console.log('✅ OWNER AUDITOR ACCESS GRANTED (SYNC) - returning all fields');
              return allFields; // Auditor of owner can see all fields
            } else {
              console.log('❌ NON-OWNER AUDITOR ACCESS (SYNC) - returning restricted fields');
              // Auditor of non-owner sees restricted fields without file name
              const restrictedFields = {
                ...baseFields,
                excel_file: {
                  _id: vehicle.excel_file._id,
                  // Don't include originalName or filename for non-owners' auditors
                }
              };
              return restrictedFields;
            }
          } else if (userRole === 'fieldAgent') {
            // Field agents always see restricted fields without file name
            const restrictedFields = {
              ...baseFields,
              excel_file: {
                _id: vehicle.excel_file._id,
                // Don't include originalName or filename for field agents
              }
            };
            return restrictedFields;
          }
        }

        // Default fallback
        return baseFields;
      });

      res.json({
        success: true,
        data: filteredVehicles,
        pagination: {
          page,
          limit,
          total: totalCount,
          pages: Math.ceil(totalCount / limit)
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

// CACHED HELPER FUNCTIONS (much faster with caching)
async function getExcelFileIdsForAdmin(adminId) {
  const cacheKey = `admin_files_${adminId}`;
  const cached = searchCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    console.log(`⚡ Cache hit for admin ${adminId}: ${cached.data.length} files`);
    return cached.data;
  }

  console.log(`🔍 Fetching files for admin ${adminId}...`);
  const files = await ExcelFile.find({
    isActive: true,
    $or: [
      { uploadedBy: adminId },
      { assignedTo: adminId },
      { assignedAdmins: adminId }
    ]
  }).select('_id').lean();
  
  const fileIds = files.map(file => file._id);
  console.log(`📁 Admin ${adminId} has access to ${fileIds.length} files:`, fileIds);
  
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
  
  const files = await ExcelFile.find({
    isActive: true,
    $or: [
      { uploadedBy: fieldAgent.createdBy },
      { assignedTo: fieldAgent.createdBy },
      { assignedAdmins: fieldAgent.createdBy }
    ]
  }).select('_id').lean();
  const fileIds = files.map(file => file._id);
  
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
  
  const files = await ExcelFile.find({
    isActive: true,
    $or: [
      { uploadedBy: auditor.createdBy },
      { assignedTo: auditor.createdBy },
      { assignedAdmins: auditor.createdBy }
    ]
  }).select('_id').lean();
  const fileIds = files.map(file => file._id);
  
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
      
      // Search for vehicle with exact registration number match
      const vehicle = await ExcelVehicle.findOne({
        registration_number: new RegExp(`^${registrationNumber.trim()}$`, 'i'),
        isActive: true
      })
      .select('registration_number make model bank customer_name loan_number status')
      .lean();

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
          registration_number: vehicle.registration_number,
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