const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/profile-images/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'profile-' + req.user._id + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  // Accept only image files
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: fileFilter
});

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
router.post('/register', [
  body('name').trim().isLength({ min: 2, max: 50 }).withMessage('Name must be between 2 and 50 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
  body('phone').matches(/^[0-9]{10}$/).withMessage('Please provide a valid 10-digit phone number'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('role').isIn(['admin', 'fieldAgent', 'auditor']).withMessage('Invalid role'),
  body('location.city').trim().notEmpty().withMessage('City is required'),
  body('location.state').trim().notEmpty().withMessage('State is required')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: errors.array()
      });
    }

    const { name, email, phone, password, role, location } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { phone }]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email or phone already exists'
      });
    }

    // Create user
    const user = await User.create({
      name,
      email,
      phone,
      password,
      role,
      location
    });

    // Generate token
    const token = user.getSignedJwtToken();

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user,
        token
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
router.post('/login', [
  body('emailOrPhone').notEmpty().withMessage('Email or phone number is required'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: errors.array()
      });
    }

    const { emailOrPhone, password } = req.body;

    // Trim whitespace from inputs to prevent issues
    const trimmedEmailOrPhone = emailOrPhone?.trim();
    const trimmedPassword = password?.trim();

    if (!trimmedEmailOrPhone || !trimmedPassword) {
      return res.status(400).json({
        success: false,
        message: 'Email/Phone and password are required'
      });
    }

    // Check if user exists by email or phone
    const user = await User.findOne({
      $or: [
        { email: trimmedEmailOrPhone },
        { phone: trimmedEmailOrPhone }
      ]
    }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    // Check password (use trimmed password)
    const isMatch = await user.matchPassword(trimmedPassword);

    if (!isMatch) {
      // Log failed login attempt for debugging (without sensitive data)
      console.log(`❌ Failed login attempt for: ${trimmedEmailOrPhone} (User ID: ${user._id}, Role: ${user.role})`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if user is fieldAgent or auditor - requires OTP
    if (['fieldAgent', 'auditor'].includes(user.role)) {
      return res.status(200).json({
        success: true,
        message: 'OTP required',
        requiresOTP: true,
        data: {
          user: {
            _id: user._id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            role: user.role
          }
        }
      });
    }

    // For admin - direct login
    // Invalidate any existing session first (single-session-per-user)
    user.invalidateSession();
    
    // Update last login and add to login history
    user.lastLogin = new Date();
    user.loginHistory.push({
      timestamp: new Date(),
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    // Generate token (this will also update session info)
    const token = user.getSignedJwtToken();
    
    // Save user once with all updates (session token, login history, etc.)
    // Note: Password is NOT modified, so pre-save hook will skip hashing
    await user.save();

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user,
        token
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
});

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('allowedSharingAdmins', 'name email')
      .select('-password -resetPasswordToken -resetPasswordExpire');

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Update user profile
// @route   PUT /api/auth/profile
// @access  Private
router.put('/profile', authenticateToken, [
  body('name').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Name must be between 2 and 50 characters'),
  body('phone').optional().matches(/^[0-9]{10}$/).withMessage('Please provide a valid 10-digit phone number'),
  body('location.city').optional().trim().notEmpty().withMessage('City is required'),
  body('location.state').optional().trim().notEmpty().withMessage('State is required')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: errors.array()
      });
    }

    const { name, phone, location } = req.body;

    // Check if phone is already taken by another user
    if (phone && phone !== req.user.phone) {
      const existingUser = await User.findOne({ phone });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Phone number already in use'
        });
      }
    }

    // Update user
    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        name: name || req.user.name,
        phone: phone || req.user.phone,
        location: location || req.user.location
      },
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: user
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during profile update'
    });
  }
});

// @desc    Upload profile image
// @route   POST /api/auth/upload-profile-image
// @access  Private
router.post('/upload-profile-image', authenticateToken, upload.single('profileImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    // Create the file path for the uploaded image
    const imagePath = `/uploads/profile-images/${req.file.filename}`;

    // Update user's profile image
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { profileImage: imagePath },
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Profile image uploaded successfully',
      data: {
        user,
        imagePath: imagePath
      }
    });
  } catch (error) {
    console.error('Upload profile image error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during image upload'
    });
  }
});

// @desc    Remove profile image
// @route   DELETE /api/auth/remove-profile-image
// @access  Private
router.delete('/remove-profile-image', authenticateToken, async (req, res) => {
  try {
    // Update user to remove profile image
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { profileImage: null },
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Profile image removed successfully',
      data: user
    });
  } catch (error) {
    console.error('Remove profile image error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during image removal'
    });
  }
});

// @desc    Get user profile with extended information
// @route   GET /api/auth/profile-details
// @access  Private
router.get('/profile-details', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('createdBy', 'name email')
      .populate('adminId', 'name email');

    // Get role-specific information
    let roleSpecificInfo = {};

    if (user.role === 'fieldAgent' || user.role === 'auditor') {
      // Get payment rates if admin has set them
      if (user.adminId) {
        const admin = await User.findById(user.adminId);
        if (admin && admin.paymentRates) {
          roleSpecificInfo.paymentRates = {
            auditorRate: admin.paymentRates.auditorRate || 0,
            fieldAgentRate: admin.paymentRates.fieldAgentRate || 0
          };
        }
      }
    }

    // Get login history (last 5 logins)
    const recentLogins = user.loginHistory
      ? user.loginHistory.slice(-5).reverse()
      : [];

    res.json({
      success: true,
      data: {
        user,
        roleSpecificInfo,
        recentLogins
      }
    });
  } catch (error) {
    console.error('Get profile details error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Change password
// @route   PUT /api/auth/change-password
// @access  Private
router.put('/change-password', authenticateToken, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: errors.array()
      });
    }

    const { currentPassword, newPassword } = req.body;

    // Get user with password
    const user = await User.findById(req.user._id).select('+password');

    // Check current password
    const isMatch = await user.matchPassword(currentPassword);

    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during password change'
    });
  }
});

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    // Invalidate current session
    await User.findByIdAndUpdate(req.user._id, {
      currentSessionToken: null,
      sessionCreatedAt: null,
      sessionExpiresAt: null,
      isOnline: false,
      lastSeen: new Date()
    });

    console.log(`User ${req.user._id} logged out at ${new Date()}`);

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during logout'
    });
  }
});

// @desc    Validate current session
// @route   GET /api/auth/validate-session
// @access  Private
router.get('/validate-session', authenticateToken, async (req, res) => {
  try {
    // Get fresh user data with online status and allowedSharingAdmins
    const user = await User.findById(req.user._id)
      .populate('allowedSharingAdmins', 'name email')
      .select('-password -resetPasswordToken -resetPasswordExpire');
    
    res.json({
      success: true,
      message: 'Session is valid',
      data: {
        user: user,
        sessionValid: true
      }
    });
  } catch (error) {
    console.error('Session validation error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during session validation'
    });
  }
});

// @desc    Update user online status
// @route   POST /api/auth/update-online-status
// @access  Private
router.post('/update-online-status', authenticateToken, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      isOnline: true,
      lastSeen: new Date()
    });

    res.json({
      success: true,
      message: 'Online status updated'
    });
  } catch (error) {
    console.error('Update online status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during online status update'
    });
  }
});

// @desc    Update user offline status
// @route   POST /api/auth/update-offline-status
// @access  Private
router.post('/update-offline-status', authenticateToken, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      isOnline: false,
      lastSeen: new Date()
    });

    res.json({
      success: true,
      message: 'Offline status updated'
    });
  } catch (error) {
    console.error('Update offline status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during offline status update'
    });
  }
});

// @desc    Check and update online status based on activity
// @route   POST /api/auth/check-online-status
// @access  Private
router.post('/check-online-status', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user has been inactive for more than 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const shouldBeOffline = user.lastSeen && user.lastSeen < fiveMinutesAgo;

    // Update online status based on activity
    if (shouldBeOffline && user.isOnline) {
      await User.findByIdAndUpdate(req.user._id, {
        isOnline: false
      });
    } else if (!shouldBeOffline && !user.isOnline) {
      await User.findByIdAndUpdate(req.user._id, {
        isOnline: true
      });
    }

    // Get updated user data
    const updatedUser = await User.findById(req.user._id).select('-password');

    res.json({
      success: true,
      message: 'Online status checked',
      data: {
        user: updatedUser
      }
    });
  } catch (error) {
    console.error('Check online status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during online status check'
    });
  }
});

// @desc    Force logout from all devices (invalidate session)
// @route   POST /api/auth/force-logout
// @access  Private
router.post('/force-logout', authenticateToken, async (req, res) => {
  try {
    // Invalidate current session
    await User.findByIdAndUpdate(req.user._id, {
      currentSessionToken: null,
      sessionCreatedAt: null,
      sessionExpiresAt: null,
      isOnline: false,
      lastSeen: new Date()
    });

    console.log(`User ${req.user._id} force logged out at ${new Date()}`);

    res.json({
      success: true,
      message: 'Logged out from all devices successfully'
    });
  } catch (error) {
    console.error('Force logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during force logout'
    });
  }
});

// @desc    Forgot password (Admin only - No email functionality)
// @route   POST /api/auth/forgot-password
// @access  Private (Admin only)
router.post('/forgot-password', authenticateToken, authorizeRole('admin'), [
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: errors.array()
      });
    }

    const { email, newPassword } = req.body;

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update password directly (admin function)
    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: 'Password updated successfully by admin'
    });
  } catch (error) {
    console.error('Admin password reset error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during password reset'
    });
  }
});

// Note: Removed public reset password endpoint since no email functionality

module.exports = router; 