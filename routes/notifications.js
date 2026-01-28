const express = require('express');
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const User = require('../models/User');
const ExcelVehicle = require('../models/ExcelVehicle');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { getLocationFromIP, getRealIP } = require('../services/geolocation');

const router = express.Router();

// @desc    Log vehicle view/verification action
// @route   POST /api/notifications/log-action
// @access  Private (fieldAgent, auditor)
router.post('/log-action',
  authenticateToken,
  authorizeRole('fieldAgent', 'auditor'),
  async (req, res) => {
    try {
      const { vehicleNumber, action, vehicleId } = req.body;

      // Validate action
      if (!['viewed', 'verified'].includes(action)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid action. Must be "viewed" or "verified"'
        });
      }

      // Get user's admin (the user who created them)
      const user = await User.findById(req.user._id).populate('createdBy');
      if (!user || !user.createdBy) {
        return res.status(400).json({
          success: false,
          message: 'User not assigned to any admin'
        });
      }

      // Get IP address and location
      const ipAddress = getRealIP(req);
      console.log(`🔍 Getting location for IP: ${ipAddress} (User: ${user.name})`);
      
      let location;
      try {
        location = await getLocationFromIP(ipAddress);
      } catch (error) {
        console.error('Location lookup failed:', error);
        location = {
          city: 'Unknown',
          region: 'Unknown',
          country: 'Unknown',
          latitude: null,
          longitude: null,
          timezone: 'Unknown',
          isp: 'Unknown'
        };
      }

      // Create notification
      const notificationData = {
        user: req.user._id,
        userName: user.name,
        userRole: user.role,
        admin: user.createdBy._id,
        action,
        vehicleNumber,
        ipAddress,
        location,
        isOnline: true
      };

      // Only add vehicleId if it's a valid ObjectId
      if (vehicleId && vehicleId.trim() !== '' && mongoose.Types.ObjectId.isValid(vehicleId)) {
        notificationData.vehicleId = vehicleId;
      }

      const notification = new Notification(notificationData);

      await notification.save();

      res.json({
        success: true,
        message: 'Action logged successfully',
        data: {
          id: notification._id,
          action,
          vehicleNumber,
          location: location.city && location.city !== 'Unknown' 
            ? `${location.city}, ${location.region}, ${location.country}`
            : 'Location not available'
        }
      });

    } catch (error) {
      console.error('Log action error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error logging action'
      });
    }
  }
);

// @desc    Get notifications for admin
// @route   GET /api/notifications
// @access  Private (admin, superAdmin, superSuperAdmin)
router.get('/',
  authenticateToken,
  authorizeRole('admin', 'superAdmin', 'superSuperAdmin'),
  async (req, res) => {
    try {
      const { page = 1, limit = 50, unreadOnly = false, search = '' } = req.query;
      const skip = (page - 1) * limit;

      // Build query based on user role
      let query = {};
      
      if (req.user.role === 'admin') {
        // Admin sees only their team's notifications
        query.admin = req.user._id;
      } else if (req.user.role === 'superAdmin') {
        // Super admin sees all notifications except superSuperAdmin's team
        const superSuperAdmins = await User.find({ role: 'superSuperAdmin' });
        const excludeAdmins = superSuperAdmins.map(u => u._id);
        query.admin = { $nin: excludeAdmins };
      }
      // superSuperAdmin sees all notifications (no filter)

      if (unreadOnly === 'true') {
        query.isRead = false;
      }

      // Add search functionality for vehicle number and user name
      if (search && search.trim()) {
        const searchTerm = search.trim();
        query.$or = [
          { vehicleNumber: { $regex: searchTerm, $options: 'i' } },
          { userName: { $regex: searchTerm, $options: 'i' } }
        ];
        console.log('🔍 Search query:', { searchTerm, query });
        
        // Debug: Log a sample notification to see the userName field
        const sampleNotification = await Notification.findOne().limit(1);
        if (sampleNotification) {
          console.log('🔍 Sample notification userName:', sampleNotification.userName);
        }
      }

      // Get notifications with pagination
      const notifications = await Notification.find(query)
        .populate('user', 'name email role')
        .populate('admin', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await Notification.countDocuments(query);
      console.log('📊 Search results:', { total, search: search || 'none' });

      // Format notifications for display
      const formattedNotifications = notifications.map(notif => {
        const locationText = notif.location && 
                             notif.location.city && 
                             notif.location.city !== 'Unknown'
          ? `${notif.location.city}${notif.location.region && notif.location.region !== 'Unknown' ? ', ' + notif.location.region : ''}`
          : notif.isOnline ? 'Location not available' : 'No Location (Offline)';

        return {
          id: notif._id,
          userName: notif.userName,
          userRole: notif.userRole,
          action: notif.action,
          vehicleNumber: notif.vehicleNumber,
          timestamp: notif.createdAt,
          location: locationText,
          fullLocation: notif.location,
          isRead: notif.isRead,
          isOnline: notif.isOnline,
          ipAddress: notif.ipAddress
        };
      });

      res.json({
        success: true,
        data: formattedNotifications,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });

    } catch (error) {
      console.error('Get notifications error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error fetching notifications'
      });
    }
  }
);

// @desc    Mark notification as read
// @route   PUT /api/notifications/:id/read
// @access  Private (admin, superAdmin, superSuperAdmin)
router.put('/:id/read',
  authenticateToken,
  authorizeRole('admin', 'superAdmin', 'superSuperAdmin'),
  async (req, res) => {
    try {
      const notification = await Notification.findById(req.params.id);

      if (!notification) {
        return res.status(404).json({
          success: false,
          message: 'Notification not found'
        });
      }

      // Check if user has permission to mark this notification as read
      if (req.user.role === 'admin' && !notification.admin.equals(req.user._id)) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to mark this notification as read'
        });
      }

      await Notification.findByIdAndUpdate(req.params.id, { isRead: true });

      res.json({
        success: true,
        message: 'Notification marked as read'
      });

    } catch (error) {
      console.error('Mark read error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error marking notification as read'
      });
    }
  }
);

// @desc    Mark all notifications as read for admin
// @route   PUT /api/notifications/mark-all-read
// @access  Private (admin, superAdmin, superSuperAdmin)
router.put('/mark-all-read',
  authenticateToken,
  authorizeRole('admin', 'superAdmin', 'superSuperAdmin'),
  async (req, res) => {
    try {
      let query = { isRead: false };
      
      if (req.user.role === 'admin') {
        query.admin = req.user._id;
      } else if (req.user.role === 'superAdmin') {
        const superSuperAdmins = await User.find({ role: 'superSuperAdmin' });
        const excludeAdmins = superSuperAdmins.map(u => u._id);
        query.admin = { $nin: excludeAdmins };
      }

      const result = await Notification.updateMany(query, { isRead: true });

      res.json({
        success: true,
        message: `Marked ${result.modifiedCount} notifications as read`
      });

    } catch (error) {
      console.error('Mark all read error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error marking notifications as read'
      });
    }
  }
);

// @desc    Get notification statistics
// @route   GET /api/notifications/stats
// @access  Private (admin, superAdmin, superSuperAdmin)
router.get('/stats',
  authenticateToken,
  authorizeRole('admin', 'superAdmin', 'superSuperAdmin'),
  async (req, res) => {
    try {
      let query = {};
      
      if (req.user.role === 'admin') {
        query.admin = req.user._id;
      } else if (req.user.role === 'superAdmin') {
        const superSuperAdmins = await User.find({ role: 'superSuperAdmin' });
        const excludeAdmins = superSuperAdmins.map(u => u._id);
        query.admin = { $nin: excludeAdmins };
      }

      const stats = await Notification.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            unread: { $sum: { $cond: [{ $eq: ['$isRead', false] }, 1, 0] } },
            viewed: { $sum: { $cond: [{ $eq: ['$action', 'viewed'] }, 1, 0] } },
            verified: { $sum: { $cond: [{ $eq: ['$action', 'verified'] }, 1, 0] } }
          }
        }
      ]);

      const result = stats[0] || { total: 0, unread: 0, viewed: 0, verified: 0 };

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      console.error('Get stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error fetching statistics'
      });
    }
  }
);

module.exports = router;
