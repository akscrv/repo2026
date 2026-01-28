const express = require('express');
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const FileStorageSettings = require('../models/FileStorageSettings');
const UserStorageLimit = require('../models/UserStorageLimit');
const ExcelFile = require('../models/ExcelFile');
const User = require('../models/User');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();

// @desc    Get all file storage settings
// @route   GET /api/file-storage/settings
// @access  Private (SuperSuperAdmin only)
router.get('/settings',
  authenticateToken,
  authorizeRole('superSuperAdmin'),
  async (req, res) => {
    try {
      const settings = await FileStorageSettings.find({ isActive: true })
        .populate('updatedBy', 'name email')
        .sort({ role: 1 });

      res.json({
        success: true,
        data: settings
      });
    } catch (error) {
      console.error('Error fetching file storage settings:', error);
      res.status(500).json({
        success: false,
        message: 'Server error while fetching file storage settings'
      });
    }
  }
);

// @desc    Get file storage setting for a specific role
// @route   GET /api/file-storage/settings/:role
// @access  Private (SuperSuperAdmin, SuperAdmin, Admin)
router.get('/settings/:role',
  authenticateToken,
  authorizeRole('superSuperAdmin', 'superAdmin', 'admin'),
  async (req, res) => {
    try {
      const { role } = req.params;
      
      // Validate role
      if (!['admin', 'superAdmin', 'superSuperAdmin'].includes(role)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid role specified'
        });
      }

      const setting = await FileStorageSettings.findOne({ 
        role, 
        isActive: true 
      }).populate('updatedBy', 'name email');

      if (!setting) {
        return res.status(404).json({
          success: false,
          message: 'File storage setting not found for this role'
        });
      }

      res.json({
        success: true,
        data: setting
      });
    } catch (error) {
      console.error('Error fetching file storage setting:', error);
      res.status(500).json({
        success: false,
        message: 'Server error while fetching file storage setting'
      });
    }
  }
);

// @desc    Update file storage setting
// @route   PUT /api/file-storage/settings/:role
// @access  Private (SuperSuperAdmin only)
router.put('/settings/:role',
  authenticateToken,
  authorizeRole('superSuperAdmin'),
  [
    body('totalRecordLimit')
      .isInt({ min: 1000, max: 10000000 })
      .withMessage('Total record limit must be between 1,000 and 10,000,000'),
    body('description')
      .isString()
      .trim()
      .isLength({ min: 10, max: 500 })
      .withMessage('Description must be between 10 and 500 characters')
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

      const { role } = req.params;
      const { totalRecordLimit, description } = req.body;

      // Validate role
      if (!['admin', 'superAdmin', 'superSuperAdmin'].includes(role)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid role specified'
        });
      }

      // Find existing setting
      let setting = await FileStorageSettings.findOne({ role });

      if (setting) {
        // Update existing setting
        setting.totalRecordLimit = totalRecordLimit;
        setting.description = description;
        setting.updatedBy = req.user._id;
        setting.isActive = true;
        await setting.save();
      } else {
        // Create new setting
        setting = new FileStorageSettings({
          role,
          totalRecordLimit,
          description,
          updatedBy: req.user._id
        });
        await setting.save();
      }

      // Populate updatedBy field
      await setting.populate('updatedBy', 'name email');

      res.json({
        success: true,
        message: 'File storage setting updated successfully',
        data: setting
      });
    } catch (error) {
      console.error('Error updating file storage setting:', error);
      res.status(500).json({
        success: false,
        message: 'Server error while updating file storage setting'
      });
    }
  }
);

// @desc    Get current user's file storage limits and usage
// @route   GET /api/file-storage/my-limits
// @access  Private (SuperSuperAdmin, SuperAdmin, Admin)
router.get('/my-limits',
  authenticateToken,
  authorizeRole('superSuperAdmin', 'superAdmin', 'admin'),
  async (req, res) => {
    try {
      const setting = await FileStorageSettings.findOne({ 
        role: req.user.role, 
        isActive: true 
      });

      if (!setting) {
        return res.status(404).json({
          success: false,
          message: 'File storage setting not found for your role'
        });
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
      const remainingRecords = Math.max(0, setting.totalRecordLimit - usedRecords);

      res.json({
        success: true,
        data: {
          role: setting.role,
          totalRecordLimit: setting.totalRecordLimit,
          usedRecords: usedRecords,
          remainingRecords: remainingRecords,
          description: setting.description
        }
      });
    } catch (error) {
      console.error('Error fetching user file storage limits:', error);
      res.status(500).json({
        success: false,
        message: 'Server error while fetching file storage limits'
      });
    }
  }
);

// @desc    Get comprehensive storage management data (SuperSuperAdmin only)
// @route   GET /api/file-storage/management
// @access  Private (SuperSuperAdmin only)
router.get('/management',
  authenticateToken,
  authorizeRole('superSuperAdmin'),
  async (req, res) => {
    try {
      const User = require('../models/User');
      
      // Get all storage plans
      const storagePlans = await FileStorageSettings.find({ isActive: true })
        .populate('updatedBy', 'name email')
        .sort({ role: 1 });

      // Get all files with details
      const allFiles = await ExcelFile.find({ isActive: true })
        .populate('uploadedBy', 'name email role')
        .populate('assignedTo', 'name email')
        .sort({ createdAt: -1 });

      // Calculate total file size (bytes)
      const totalFileSize = allFiles.reduce((sum, file) => sum + (file.fileSize || 0), 0);

      // Calculate total records
      const totalRecords = allFiles
        .filter(file => ['completed', 'partial'].includes(file.status))
        .reduce((sum, file) => sum + (file.totalRows || 0), 0);

      // Get per-role statistics
      const roleStats = await ExcelFile.aggregate([
        {
          $match: {
            isActive: true,
            status: { $in: ['completed', 'partial'] }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'uploadedBy',
            foreignField: '_id',
            as: 'uploader'
          }
        },
        {
          $unwind: '$uploader'
        },
        {
          $group: {
            _id: '$uploader.role',
            totalRecords: { $sum: '$totalRows' },
            totalFileSize: { $sum: '$fileSize' },
            fileCount: { $sum: 1 }
          }
        },
        {
          $project: {
            role: '$_id',
            totalRecords: 1,
            totalFileSize: 1,
            fileCount: 1,
            _id: 0
          }
        }
      ]);

      // Get per-admin usage (for admin, superAdmin, superSuperAdmin roles)
      const adminUsers = await User.find({
        role: { $in: ['admin', 'superAdmin', 'superSuperAdmin'] },
        isActive: true
      }).select('_id name email role');

      const adminUsage = await Promise.all(
        adminUsers.map(async (admin) => {
          const adminFiles = await ExcelFile.aggregate([
            {
              $match: {
                uploadedBy: admin._id,
                isActive: true,
                status: { $in: ['completed', 'partial'] }
              }
            },
            {
              $group: {
                _id: null,
                totalRecords: { $sum: '$totalRows' },
                totalFileSize: { $sum: '$fileSize' },
                fileCount: { $sum: 1 }
              }
            }
          ]);

          const usage = adminFiles.length > 0 ? adminFiles[0] : {
            totalRecords: 0,
            totalFileSize: 0,
            fileCount: 0
          };

              // Get storage limit - check individual first, then role
          const individualLimit = await UserStorageLimit.findOne({ 
            userId: admin._id, 
            isActive: true 
          });
          
          let limit = 0;
          let limitType = 'role';
          
          if (individualLimit) {
            limit = individualLimit.totalRecordLimit;
            limitType = 'individual';
          } else {
            const plan = storagePlans.find(p => p.role === admin.role);
            limit = plan ? plan.totalRecordLimit : 0;
            limitType = 'role';
          }
          
          const remaining = Math.max(0, limit - usage.totalRecords);
          const usagePercent = limit > 0 ? (usage.totalRecords / limit) * 100 : 0;

          return {
            adminId: admin._id,
            adminName: admin.name,
            adminEmail: admin.email,
            adminRole: admin.role,
            usedRecords: usage.totalRecords,
            usedFileSize: usage.totalFileSize,
            fileCount: usage.fileCount,
            recordLimit: limit,
            limitType: limitType,
            remainingRecords: remaining,
            usagePercent: Math.round(usagePercent * 100) / 100,
            hasCustomLimit: limitType === 'individual'
          };
        })
      );

      // Get individual file details
      const fileDetails = allFiles.map(file => ({
        fileId: file._id,
        filename: file.filename,
        originalName: file.originalName,
        fileSize: file.fileSize,
        fileSizeMB: ((file.fileSize || 0) / (1024 * 1024)).toFixed(2),
        totalRows: file.totalRows,
        processedRows: file.processedRows,
        failedRows: file.failedRows,
        skippedRows: file.skippedRows,
        status: file.status,
        uploadedBy: {
          id: file.uploadedBy?._id,
          name: file.uploadedBy?.name,
          email: file.uploadedBy?.email,
          role: file.uploadedBy?.role
        },
        assignedTo: {
          id: file.assignedTo?._id,
          name: file.assignedTo?.name,
          email: file.assignedTo?.email
        },
        createdAt: file.createdAt,
        updatedAt: file.updatedAt
      }));

      // Fetch MongoDB collection statistics - Get ALL collections dynamically
      const db = mongoose.connection.db;
      const collectionStats = {};
      
      // Get all collection names from the database
      let collectionNames = [];
      try {
        const collectionsList = await db.listCollections().toArray();
        collectionNames = collectionsList
          .map(col => col.name)
          .filter(name => !name.startsWith('system.')); // Exclude system collections
      } catch (err) {
        console.error('Error listing collections:', err);
        // Fallback to known collections if listing fails
        collectionNames = ['excelfiles', 'excelvehicles', 'users', 'filestoragesettings', 'userstoragelimits', 
                          'notifications', 'payments', 'moneyexcelfiles', 'moneyrecords', 'inventories',
                          'adminpayments', 'adminpaymentrates', 'appversions', 'backofficenumbers',
                          'paymentproofs', 'paymentqrs', 'userotps'];
      }
      
      // Fetch stats for all collections
      for (const collectionName of collectionNames) {
        try {
          const stats = await db.collection(collectionName).stats({ scale: 1 });
          // MongoDB stats: size = uncompressed data size, storageSize = compressed storage size
          collectionStats[collectionName] = {
            count: stats.count || 0,
            size: stats.size || 0, // Uncompressed size in bytes
            sizeMB: ((stats.size || 0) / (1024 * 1024)).toFixed(2),
            sizeGB: ((stats.size || 0) / (1024 * 1024 * 1024)).toFixed(4),
            storageSize: stats.storageSize || 0, // Compressed storage size in bytes
            storageSizeMB: ((stats.storageSize || 0) / (1024 * 1024)).toFixed(2),
            storageSizeGB: ((stats.storageSize || 0) / (1024 * 1024 * 1024)).toFixed(4),
            totalIndexSize: stats.totalIndexSize || 0,
            totalIndexSizeMB: ((stats.totalIndexSize || 0) / (1024 * 1024)).toFixed(2),
            avgObjSize: stats.avgObjSize || 0,
            nindexes: stats.nindexes || 0
          };
        } catch (err) {
          console.error(`Error fetching stats for collection ${collectionName}:`, err);
          collectionStats[collectionName] = {
            count: 0,
            size: 0,
            sizeMB: '0.00',
            sizeGB: '0.0000',
            storageSize: 0,
            storageSizeMB: '0.00',
            storageSizeGB: '0.0000',
            totalIndexSize: 0,
            totalIndexSizeMB: '0.00',
            avgObjSize: 0,
            nindexes: 0,
            error: err.message
          };
        }
      }

      // Fetch database-level statistics
      let dbStats = {};
      try {
        const stats = await db.stats({ scale: 1 });
        // MongoDB db.stats: dataSize = uncompressed data size, storageSize = compressed storage size
        dbStats = {
          dataSize: stats.dataSize || 0, // Uncompressed data size in bytes
          dataSizeMB: ((stats.dataSize || 0) / (1024 * 1024)).toFixed(2),
          dataSizeGB: ((stats.dataSize || 0) / (1024 * 1024 * 1024)).toFixed(4),
          storageSize: stats.storageSize || 0, // Compressed storage size in bytes
          storageSizeMB: ((stats.storageSize || 0) / (1024 * 1024)).toFixed(2),
          storageSizeGB: ((stats.storageSize || 0) / (1024 * 1024 * 1024)).toFixed(4),
          indexSize: stats.indexSize || 0, // Total index size in bytes
          indexSizeMB: ((stats.indexSize || 0) / (1024 * 1024)).toFixed(2),
          indexSizeGB: ((stats.indexSize || 0) / (1024 * 1024 * 1024)).toFixed(4),
          collections: stats.collections || 0,
          objects: stats.objects || 0,
          avgObjSize: stats.avgObjSize || 0
        };
      } catch (err) {
        console.error('Error fetching database stats:', err);
        dbStats = {
          error: err.message
        };
      }

      res.json({
        success: true,
        data: {
          summary: {
            totalFiles: allFiles.length,
            totalFileSize: totalFileSize,
            totalFileSizeMB: (totalFileSize / (1024 * 1024)).toFixed(2),
            totalFileSizeGB: (totalFileSize / (1024 * 1024 * 1024)).toFixed(2),
            totalRecords: totalRecords,
            activeFiles: allFiles.filter(f => ['completed', 'partial'].includes(f.status)).length,
            failedFiles: allFiles.filter(f => f.status === 'failed').length,
            processingFiles: allFiles.filter(f => f.status === 'processing').length
          },
          storagePlans: storagePlans.map(plan => ({
            role: plan.role,
            totalRecordLimit: plan.totalRecordLimit,
            description: plan.description,
            updatedBy: plan.updatedBy,
            updatedAt: plan.updatedAt
          })),
          roleStatistics: roleStats,
          adminUsage: adminUsage.sort((a, b) => b.usedRecords - a.usedRecords),
          fileDetails: fileDetails,
          collectionStatistics: collectionStats,
          dbStats: dbStats
        }
      });
    } catch (error) {
      console.error('Error fetching storage management data:', error);
      res.status(500).json({
        success: false,
        message: 'Server error while fetching storage management data',
        error: error.message
      });
    }
  }
);

// @desc    Get all admins with their storage limits and usage
// @route   GET /api/file-storage/admin-limits
// @access  Private (SuperSuperAdmin only)
router.get('/admin-limits',
  authenticateToken,
  authorizeRole('superSuperAdmin'),
  async (req, res) => {
    try {
      // Get all admin users
      const adminUsers = await User.find({
        role: { $in: ['admin', 'superAdmin', 'superSuperAdmin'] },
        isActive: true
      }).select('_id name email role').sort({ role: 1, name: 1 });

      // Get all individual limits
      const individualLimits = await UserStorageLimit.find({ isActive: true })
        .populate('updatedBy', 'name email');

      // Get role-based limits
      const roleLimits = await FileStorageSettings.find({ isActive: true });

      // Get usage for each admin
      const adminLimitsData = await Promise.all(
        adminUsers.map(async (admin) => {
          // Get individual limit if exists
          const individualLimit = individualLimits.find(il => il.userId.toString() === admin._id.toString());
          
          // Get role limit
          const roleLimit = roleLimits.find(rl => rl.role === admin.role);
          
          // Calculate usage
          const usage = await ExcelFile.aggregate([
            {
              $match: {
                uploadedBy: admin._id,
                isActive: true,
                status: { $in: ['completed', 'partial'] }
              }
            },
            {
              $group: {
                _id: null,
                totalRecords: { $sum: '$totalRows' },
                totalFileSize: { $sum: '$fileSize' },
                fileCount: { $sum: 1 }
              }
            }
          ]);

          const usageData = usage.length > 0 ? usage[0] : {
            totalRecords: 0,
            totalFileSize: 0,
            fileCount: 0
          };

          // Determine which limit applies
          let currentLimit = 0;
          let limitType = 'role';
          let limitDescription = '';
          
          if (individualLimit) {
            currentLimit = individualLimit.totalRecordLimit;
            limitType = 'individual';
            limitDescription = individualLimit.description || 'Custom individual limit';
          } else if (roleLimit) {
            currentLimit = roleLimit.totalRecordLimit;
            limitType = 'role';
            limitDescription = roleLimit.description || `Default ${admin.role} limit`;
          }

          const remaining = Math.max(0, currentLimit - usageData.totalRecords);
          const usagePercent = currentLimit > 0 ? (usageData.totalRecords / currentLimit) * 100 : 0;

          return {
            userId: admin._id,
            userName: admin.name,
            userEmail: admin.email,
            userRole: admin.role,
            usedRecords: usageData.totalRecords,
            usedFileSize: usageData.totalFileSize,
            fileCount: usageData.fileCount,
            currentLimit: currentLimit,
            limitType: limitType,
            limitDescription: limitDescription,
            remainingRecords: remaining,
            usagePercent: Math.round(usagePercent * 100) / 100,
            hasCustomLimit: limitType === 'individual',
            individualLimit: individualLimit ? {
              _id: individualLimit._id,
              totalRecordLimit: individualLimit.totalRecordLimit,
              description: individualLimit.description,
              updatedBy: individualLimit.updatedBy,
              updatedAt: individualLimit.updatedAt
            } : null,
            roleLimit: roleLimit ? {
              totalRecordLimit: roleLimit.totalRecordLimit,
              description: roleLimit.description
            } : null
          };
        })
      );

      res.json({
        success: true,
        data: adminLimitsData
      });
    } catch (error) {
      console.error('Error fetching admin limits:', error);
      res.status(500).json({
        success: false,
        message: 'Server error while fetching admin limits',
        error: error.message
      });
    }
  }
);

// @desc    Set or update individual storage limit for a user
// @route   POST /api/file-storage/user-limit
// @route   PUT /api/file-storage/user-limit/:userId
// @access  Private (SuperSuperAdmin only)
router.post('/user-limit',
  authenticateToken,
  authorizeRole('superSuperAdmin'),
  [
    body('userId')
      .notEmpty()
      .withMessage('User ID is required')
      .custom(async (value) => {
        const user = await User.findById(value);
        if (!user) {
          throw new Error('User not found');
        }
        if (!['admin', 'superAdmin', 'superSuperAdmin'].includes(user.role)) {
          throw new Error('Can only set limits for admin, superAdmin, or superSuperAdmin');
        }
        return true;
      }),
    body('totalRecordLimit')
      .isInt({ min: 1000, max: 10000000 })
      .withMessage('Total record limit must be between 1,000 and 10,000,000'),
    body('description')
      .optional()
      .isString()
      .trim()
      .isLength({ min: 10, max: 500 })
      .withMessage('Description must be between 10 and 500 characters')
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

      const { userId, totalRecordLimit, description } = req.body;

      // Check if limit already exists
      let userLimit = await UserStorageLimit.findOne({ userId, isActive: true });

      if (userLimit) {
        // Update existing limit
        userLimit.totalRecordLimit = totalRecordLimit;
        userLimit.description = description || userLimit.description;
        userLimit.updatedBy = req.user._id;
        await userLimit.save();
      } else {
        // Create new limit
        userLimit = new UserStorageLimit({
          userId,
          totalRecordLimit,
          description: description || 'Custom individual storage limit',
          updatedBy: req.user._id
        });
        await userLimit.save();
      }

      await userLimit.populate('userId', 'name email role');
      await userLimit.populate('updatedBy', 'name email');

      res.json({
        success: true,
        message: 'User storage limit set successfully',
        data: userLimit
      });
    } catch (error) {
      console.error('Error setting user storage limit:', error);
      res.status(500).json({
        success: false,
        message: 'Server error while setting user storage limit',
        error: error.message
      });
    }
  }
);

// @desc    Update individual storage limit for a user
// @route   PUT /api/file-storage/user-limit/:userId
// @access  Private (SuperSuperAdmin only)
router.put('/user-limit/:userId',
  authenticateToken,
  authorizeRole('superSuperAdmin'),
  [
    body('totalRecordLimit')
      .isInt({ min: 1000, max: 10000000 })
      .withMessage('Total record limit must be between 1,000 and 10,000,000'),
    body('description')
      .optional()
      .isString()
      .trim()
      .isLength({ min: 10, max: 500 })
      .withMessage('Description must be between 10 and 500 characters')
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

      const { userId } = req.params;
      const { totalRecordLimit, description } = req.body;

      // Verify user exists and is admin/superAdmin/superSuperAdmin
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      if (!['admin', 'superAdmin', 'superSuperAdmin'].includes(user.role)) {
        return res.status(400).json({
          success: false,
          message: 'Can only set limits for admin, superAdmin, or superSuperAdmin'
        });
      }

      // Find or create limit
      let userLimit = await UserStorageLimit.findOne({ userId, isActive: true });

      if (userLimit) {
        userLimit.totalRecordLimit = totalRecordLimit;
        if (description) {
          userLimit.description = description;
        }
        userLimit.updatedBy = req.user._id;
        await userLimit.save();
      } else {
        userLimit = new UserStorageLimit({
          userId,
          totalRecordLimit,
          description: description || 'Custom individual storage limit',
          updatedBy: req.user._id
        });
        await userLimit.save();
      }

      await userLimit.populate('userId', 'name email role');
      await userLimit.populate('updatedBy', 'name email');

      res.json({
        success: true,
        message: 'User storage limit updated successfully',
        data: userLimit
      });
    } catch (error) {
      console.error('Error updating user storage limit:', error);
      res.status(500).json({
        success: false,
        message: 'Server error while updating user storage limit',
        error: error.message
      });
    }
  }
);

// @desc    Delete individual storage limit (revert to role limit)
// @route   DELETE /api/file-storage/user-limit/:userId
// @access  Private (SuperSuperAdmin only)
router.delete('/user-limit/:userId',
  authenticateToken,
  authorizeRole('superSuperAdmin'),
  async (req, res) => {
    try {
      const { userId } = req.params;

      const userLimit = await UserStorageLimit.findOne({ userId, isActive: true });

      if (!userLimit) {
        return res.status(404).json({
          success: false,
          message: 'User storage limit not found'
        });
      }

      // Soft delete by setting isActive to false
      userLimit.isActive = false;
      await userLimit.save();

      res.json({
        success: true,
        message: 'User storage limit removed. User will now use role-based limit.'
      });
    } catch (error) {
      console.error('Error deleting user storage limit:', error);
      res.status(500).json({
        success: false,
        message: 'Server error while deleting user storage limit',
        error: error.message
      });
    }
  }
);

// @desc    Get current user's storage limits and usage (updated to check individual first)
// @route   GET /api/file-storage/my-limits
// @access  Private (SuperSuperAdmin, SuperAdmin, Admin)
router.get('/my-limits',
  authenticateToken,
  authorizeRole('superSuperAdmin', 'superAdmin', 'admin'),
  async (req, res) => {
    try {
      // Check individual limit first
      let userStorageLimit = await UserStorageLimit.findOne({ 
        userId: req.user._id, 
        isActive: true 
      });

      let totalRecordLimit;
      let limitType = 'role';
      let description = '';

      if (userStorageLimit) {
        totalRecordLimit = userStorageLimit.totalRecordLimit;
        limitType = 'individual';
        description = userStorageLimit.description;
      } else {
        // Fall back to role limit
        const setting = await FileStorageSettings.findOne({ 
          role: req.user.role, 
          isActive: true 
        });

        if (!setting) {
          return res.status(404).json({
            success: false,
            message: 'File storage setting not found for your role'
          });
        }

        totalRecordLimit = setting.totalRecordLimit;
        limitType = 'role';
        description = setting.description;
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

      res.json({
        success: true,
        data: {
          role: req.user.role,
          totalRecordLimit: totalRecordLimit,
          usedRecords: usedRecords,
          remainingRecords: remainingRecords,
          description: description,
          limitType: limitType,
          hasCustomLimit: limitType === 'individual'
        }
      });
    } catch (error) {
      console.error('Error fetching user file storage limits:', error);
      res.status(500).json({
        success: false,
        message: 'Server error while fetching file storage limits'
      });
    }
  }
);

module.exports = router;

