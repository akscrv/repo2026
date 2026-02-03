const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const AppVersion = require('../models/AppVersion');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

// Configure multer for APK file uploads
const apkStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, '..', 'uploads', 'apps');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const appType = req.body.appType || 'main';
    const version = req.body.version || '1.0.0';
    const timestamp = Date.now();
    cb(null, `${appType}-app-v${version}-${timestamp}.apk`);
  }
});

const apkUpload = multer({
  storage: apkStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.android.package-archive' || 
        file.originalname.endsWith('.apk')) {
      cb(null, true);
    } else {
      cb(new Error('Only APK files are allowed'));
    }
  },
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  }
});

// @desc    Upload new app version (SuperSuperAdmin only)
// @route   POST /api/app-management/upload
// @access  Private (SuperSuperAdmin)
router.post('/upload',
  authenticateToken,
  authorizeRole('superSuperAdmin'),
  apkUpload.single('apkFile'),
  [
    body('appType').isIn(['main', 'emergency']).withMessage('App type must be main or emergency'),
    body('version').notEmpty().withMessage('Version is required'),
    body('versionCode').isInt({ min: 1 }).withMessage('Version code must be a positive integer'),
    body('description').optional().isString().withMessage('Description must be a string')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation errors',
          errors: errors.array()
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'APK file is required'
        });
      }

      const { appType, version, versionCode, description, features } = req.body;

      // Deactivate current active version for this app type
      await AppVersion.updateMany(
        { appType, isActive: true },
        { isActive: false }
      );

      // Create new app version
      const appVersion = new AppVersion({
        appType,
        version,
        versionCode: parseInt(versionCode),
        fileName: req.file.originalname,
        filePath: `/uploads/apps/${req.file.filename}`,
        fileSize: req.file.size,
        description: description || '',
        features: features ? features.split(',').map(f => f.trim()) : [],
        uploadedBy: req.user._id
      });

      await appVersion.save();

      res.status(201).json({
        success: true,
        message: `${appType} app version ${version} uploaded successfully`,
        data: appVersion
      });

    } catch (error) {
      console.error('Error uploading app version:', error);
      res.status(500).json({
        success: false,
        message: 'Server error while uploading app version'
      });
    }
  }
);

// @desc    Get all app versions (SuperSuperAdmin only)
// @route   GET /api/app-management/versions
// @access  Private (SuperSuperAdmin)
router.get('/versions',
  authenticateToken,
  authorizeRole('superSuperAdmin'),
  async (req, res) => {
    try {
      const { page = 1, limit = 10, appType } = req.query;
      
      const query = {};
      if (appType) {
        query.appType = appType;
      }

      const appVersions = await AppVersion.find(query)
        .populate('uploadedBy', 'name email')
        .sort({ createdAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .exec();

      const total = await AppVersion.countDocuments(query);

      res.json({
        success: true,
        data: appVersions,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      });

    } catch (error) {
      console.error('Error fetching app versions:', error);
      res.status(500).json({
        success: false,
        message: 'Server error while fetching app versions'
      });
    }
  }
);

// @desc    Get active app versions for public download
// @route   GET /api/app-management/public/versions
// @access  Public
router.get('/public/versions', async (req, res) => {
  try {
    console.log('📱 Public app versions request received');
    
    const appVersions = await AppVersion.find({ isActive: true })
      .populate('uploadedBy', 'name')
      .sort({ createdAt: -1 })
      .lean(); // Use lean() for better performance

    console.log(`📱 Found ${appVersions.length} active app version(s)`);
    
    // Log version details for debugging
    appVersions.forEach((version, index) => {
      console.log(`  ${index + 1}. ${version.appType} - v${version.version} (Code: ${version.versionCode})`);
    });

    // Ensure data is always an array (not null)
    res.json({
      success: true,
      data: appVersions || []
    });

  } catch (error) {
    console.error('❌ Error fetching public app versions:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching app versions',
      data: [] // Return empty array on error
    });
  }
});

// @desc    Download app file
// @route   GET /api/app-management/download/:id
// @access  Public
router.get('/download/:id', async (req, res) => {
  try {
    console.log(`📥 App download request for ID: ${req.params.id}`);
    
    const appVersion = await AppVersion.findById(req.params.id);
    
    if (!appVersion) {
      console.log(`❌ App version not found: ${req.params.id}`);
      return res.status(404).json({
        success: false,
        message: 'App version not found'
      });
    }

    console.log(`📥 Downloading: ${appVersion.fileName} (${appVersion.appType} v${appVersion.version})`);

    // Increment download count
    appVersion.downloadCount += 1;
    await appVersion.save();
    console.log(`📊 Download count updated: ${appVersion.downloadCount}`);

    const filePath = path.join(__dirname, '..', appVersion.filePath);
    
    if (!fs.existsSync(filePath)) {
      console.error(`❌ APK file not found at: ${filePath}`);
      return res.status(404).json({
        success: false,
        message: 'App file not found on server'
      });
    }

    // Set appropriate headers for APK download
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', `attachment; filename="${appVersion.fileName}"`);
    
    console.log(`✅ Sending APK file: ${appVersion.fileName}`);
    res.download(filePath, appVersion.fileName, (err) => {
      if (err) {
        console.error('❌ Error sending file:', err);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            message: 'Error downloading file'
          });
        }
      } else {
        console.log(`✅ APK file sent successfully: ${appVersion.fileName}`);
      }
    });

  } catch (error) {
    console.error('❌ Error downloading app:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while downloading app'
    });
  }
});

// @desc    Delete app version (SuperSuperAdmin only)
// @route   DELETE /api/app-management/versions/:id
// @access  Private (SuperSuperAdmin)
router.delete('/versions/:id',
  authenticateToken,
  authorizeRole('superSuperAdmin'),
  async (req, res) => {
    try {
      const appVersion = await AppVersion.findById(req.params.id);
      
      if (!appVersion) {
        return res.status(404).json({
          success: false,
          message: 'App version not found'
        });
      }

      // Delete the file from server
      const filePath = path.join(__dirname, '..', appVersion.filePath);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // Delete from database
      await AppVersion.findByIdAndDelete(req.params.id);

      res.json({
        success: true,
        message: 'App version deleted successfully'
      });

    } catch (error) {
      console.error('Error deleting app version:', error);
      res.status(500).json({
        success: false,
        message: 'Server error while deleting app version'
      });
    }
  }
);

// @desc    Activate/Deactivate app version (SuperSuperAdmin only)
// @route   PUT /api/app-management/versions/:id/status
// @access  Private (SuperSuperAdmin)
router.put('/versions/:id/status',
  authenticateToken,
  authorizeRole('superSuperAdmin'),
  [
    body('isActive').isBoolean().withMessage('isActive must be a boolean')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation errors',
          errors: errors.array()
        });
      }

      const { isActive } = req.body;
      const appVersion = await AppVersion.findById(req.params.id);
      
      if (!appVersion) {
        return res.status(404).json({
          success: false,
          message: 'App version not found'
        });
      }

      if (isActive) {
        // Deactivate other versions of the same app type
        await AppVersion.updateMany(
          { appType: appVersion.appType, _id: { $ne: req.params.id } },
          { isActive: false }
        );
      }

      appVersion.isActive = isActive;
      await appVersion.save();

      res.json({
        success: true,
        message: `App version ${isActive ? 'activated' : 'deactivated'} successfully`,
        data: appVersion
      });

    } catch (error) {
      console.error('Error updating app version status:', error);
      res.status(500).json({
        success: false,
        message: 'Server error while updating app version status'
      });
    }
  }
);

module.exports = router;
