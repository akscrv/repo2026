const express = require('express');
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const User = require('../models/User');
const ExcelVehicle = require('../models/ExcelVehicle');
const ExcelFile = require('../models/ExcelFile');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { getLocationFromIP, getRealIP } = require('../services/geolocation');
const crypto = require('crypto');

const router = express.Router();

// Helper function to mask filename
const maskFilename = (originalName) => {
  const hash = crypto.createHash('md5').update(originalName).digest('hex').substring(0, 8);
  const extension = originalName.split('.').pop();
  return `FILE_${hash.toUpperCase()}.${extension}`;
};

// @desc    Log vehicle view/verification/search action
// @route   POST /api/notifications/log-action
// @access  Private (fieldAgent, auditor, admin)
router.post('/log-action',
  authenticateToken,
  authorizeRole('fieldAgent', 'auditor', 'admin'),
  async (req, res) => {
    try {
      const { vehicleNumber, action, vehicleId, excelFileId, isOnline } = req.body;

      // Validate action
      if (!['viewed', 'verified', 'searched'].includes(action)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid action. Must be "viewed", "verified", or "searched"'
        });
      }

      const user = await User.findById(req.user._id);
      if (!user) {
        return res.status(400).json({
          success: false,
          message: 'User not found'
        });
      }

      // Get IP address and location
      const ipAddress = getRealIP(req);
      console.log(`🔍 Getting location for IP: ${ipAddress} (User: ${user.name}, Role: ${user.role})`);
      
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

      // Get file information if vehicleId or excelFileId is provided
      let excelFile = null;
      
      if (excelFileId && mongoose.Types.ObjectId.isValid(excelFileId)) {
        excelFile = await ExcelFile.findById(excelFileId).populate('uploadedBy', 'role');
      } else if (vehicleId && mongoose.Types.ObjectId.isValid(vehicleId)) {
        const vehicle = await ExcelVehicle.findById(vehicleId).populate('excel_file');
        if (vehicle && vehicle.excel_file) {
          excelFile = await ExcelFile.findById(vehicle.excel_file._id).populate('uploadedBy', 'role');
        }
      }

      if (excelFile) {
        const uploaderRole = excelFile.uploadedBy?.role || 'admin';
        const primaryAdminId = excelFile.assignedTo;
        const sharedAdmins = excelFile.sharedAdmins || []; // Admin-to-admin file sharing
        const isSuperAdminUpload = uploaderRole === 'superAdmin' || uploaderRole === 'superSuperAdmin';
        const isAdminUpload = uploaderRole === 'admin';
        
        // Determine who should receive notifications and what file name to show
        if (user.role === 'fieldAgent' || user.role === 'auditor') {
          // Field Agent or Auditor search
          const userAdmin = await User.findById(user.createdBy);
          
          if (!userAdmin) {
            return res.status(400).json({
              success: false,
              message: 'User not assigned to any admin'
            });
          }

          const isPrimaryAdmin = userAdmin._id.toString() === primaryAdminId.toString();
          const isOwnerAdmin = !isSuperAdminUpload && userAdmin._id.toString() === excelFile.uploadedBy._id.toString();
          const isSharedAdmin = isAdminUpload && sharedAdmins.some(adminId => adminId.toString() === userAdmin._id.toString());

          // Get primary admin name when masked file name will be used
          let primaryAdminName = null;
          if (!isPrimaryAdmin && !isOwnerAdmin && primaryAdminId) {
            const primaryAdmin = await User.findById(primaryAdminId).select('name').lean();
            primaryAdminName = primaryAdmin?.name || null;
          }

          // Create notifications
          const notifications = [];

          // Notification to Admin (always)
          const adminNotificationData = {
            user: req.user._id,
            userName: user.name,
            userRole: user.role,
            admin: userAdmin._id,
            adminName: userAdmin.name, // Add admin name for field agent/auditor actions
            action,
            vehicleNumber,
            vehicleId: vehicleId && mongoose.Types.ObjectId.isValid(vehicleId) ? vehicleId : null,
            excelFileId: excelFile._id,
            primaryAdminId: primaryAdminId,
            primaryAdminName: primaryAdminName, // Primary admin name (for masked file notifications)
            fileUploaderRole: uploaderRole,
            ipAddress,
            location,
            isOnline: isOnline !== undefined ? isOnline : true // Default to true if not provided (backward compatibility)
          };

          // Set file name based on admin's access
          if (isPrimaryAdmin || isOwnerAdmin) {
            adminNotificationData.fileName = excelFile.originalName;
            adminNotificationData.primaryAdminName = null; // Not needed for real filename
          } else {
            adminNotificationData.maskedFileName = maskFilename(excelFile.originalName);
          }

          notifications.push(adminNotificationData);

          // If field agent searches, also notify auditor
          if (user.role === 'fieldAgent') {
            const auditors = await User.find({
              createdBy: userAdmin._id,
              role: 'auditor',
              isActive: true
            });

            for (const auditor of auditors) {
              const auditorNotificationData = {
                ...adminNotificationData,
                admin: auditor._id,
                primaryAdminName: primaryAdminName // Include primary admin name for masked file notifications
              };
              // Auditor sees same file name as their admin
              if (isPrimaryAdmin || isOwnerAdmin) {
                auditorNotificationData.fileName = excelFile.originalName;
                auditorNotificationData.primaryAdminName = null; // Not needed for real filename
              } else {
                auditorNotificationData.maskedFileName = maskFilename(excelFile.originalName);
              }
              notifications.push(auditorNotificationData);
            }
          }

          // If SuperAdmin upload and not primary admin, also notify primary admin and their auditors
          if (isSuperAdminUpload && !isPrimaryAdmin) {
            const primaryAdmin = await User.findById(primaryAdminId);
            if (primaryAdmin) {
              // Notify primary admin
              const primaryAdminNotificationData = {
                user: req.user._id,
                userName: user.name,
                userRole: user.role,
                admin: primaryAdminId,
                adminName: userAdmin.name, // Add admin name (the assigned admin whose field agent/auditor performed action)
                action,
                vehicleNumber,
                vehicleId: vehicleId && mongoose.Types.ObjectId.isValid(vehicleId) ? vehicleId : null,
                excelFileId: excelFile._id,
                primaryAdminId: primaryAdminId,
                fileUploaderRole: uploaderRole,
                fileName: excelFile.originalName, // Primary admin sees real file name
                ipAddress,
                location,
                isOnline: true
              };
              notifications.push(primaryAdminNotificationData);

              // Notify primary admin's auditors
              const primaryAuditors = await User.find({
                createdBy: primaryAdminId,
                role: 'auditor',
                isActive: true
              });

              for (const auditor of primaryAuditors) {
                const auditorNotificationData = {
                  ...primaryAdminNotificationData,
                  admin: auditor._id,
                  fileName: excelFile.originalName // Auditors of primary admin see real file name
                };
                notifications.push(auditorNotificationData);
              }
            }
          }

          // If Admin upload and shared admin's field agent/auditor, also notify primary admin and their auditors
          if (isAdminUpload && isSharedAdmin && !isOwnerAdmin) {
            const primaryAdmin = await User.findById(excelFile.uploadedBy._id);
            if (primaryAdmin) {
              // Notify primary admin (file owner) with full details
              const primaryAdminNotificationData = {
                user: req.user._id,
                userName: user.name,
                userRole: user.role,
                admin: excelFile.uploadedBy._id,
                adminName: userAdmin.name, // Shared admin name
                action,
                vehicleNumber,
                vehicleId: vehicleId && mongoose.Types.ObjectId.isValid(vehicleId) ? vehicleId : null,
                excelFileId: excelFile._id,
                primaryAdminId: excelFile.uploadedBy._id,
                fileUploaderRole: uploaderRole,
                fileName: excelFile.originalName, // Primary admin sees real file name
                ipAddress,
                location,
                isOnline: true
              };
              notifications.push(primaryAdminNotificationData);

              // Notify primary admin's auditors with full details
              const primaryAuditors = await User.find({
                createdBy: excelFile.uploadedBy._id,
                role: 'auditor',
                isActive: true
              });

              for (const auditor of primaryAuditors) {
                const auditorNotificationData = {
                  ...primaryAdminNotificationData,
                  admin: auditor._id,
                  fileName: excelFile.originalName // Auditors of primary admin see real file name
                };
                notifications.push(auditorNotificationData);
              }
            }
          }

          // Save all notifications
          const savedNotifications = await Notification.insertMany(notifications);

          res.json({
            success: true,
            message: 'Action logged successfully',
            data: {
              notificationsCreated: savedNotifications.length,
              action,
              vehicleNumber,
              location: location.city && location.city !== 'Unknown' 
                ? `${location.city}, ${location.region}, ${location.country}`
                : 'Location not available'
            }
          });

        } else if (user.role === 'admin') {
          // Admin search
          const isPrimaryAdmin = user._id.toString() === primaryAdminId.toString();
          const isOwnerAdmin = isAdminUpload && user._id.toString() === excelFile.uploadedBy._id.toString();
          const isSharedAdmin = isAdminUpload && sharedAdmins.some(adminId => adminId.toString() === user._id.toString());
          const notifications = [];

          if (isSuperAdminUpload && !isPrimaryAdmin) {
            // SuperAdmin upload - notify primary admin and their auditors
            const primaryAdmin = await User.findById(primaryAdminId);
            if (primaryAdmin) {
              const primaryAdminNotificationData = {
                user: req.user._id,
                userName: user.name,
                userRole: 'admin',
                admin: primaryAdminId,
                action: 'searched',
                vehicleNumber,
                vehicleId: vehicleId && mongoose.Types.ObjectId.isValid(vehicleId) ? vehicleId : null,
                excelFileId: excelFile._id,
                primaryAdminId: primaryAdminId,
                fileUploaderRole: uploaderRole,
                fileName: excelFile.originalName, // Primary admin sees real file name
                ipAddress,
                location,
                isOnline: true
              };
              notifications.push(primaryAdminNotificationData);

              // Notify primary admin's auditors
              const primaryAuditors = await User.find({
                createdBy: primaryAdminId,
                role: 'auditor',
                isActive: true
              });

              for (const auditor of primaryAuditors) {
                const auditorNotificationData = {
                  ...primaryAdminNotificationData,
                  admin: auditor._id,
                  fileName: excelFile.originalName // Auditors see real file name
                };
                notifications.push(auditorNotificationData);
              }
            }
          } else if (isAdminUpload && isSharedAdmin && !isOwnerAdmin) {
            // Shared admin search - notify primary admin (file owner) and their auditors with full details
            const primaryAdmin = await User.findById(excelFile.uploadedBy._id);
            if (primaryAdmin) {
              const primaryAdminNotificationData = {
                user: req.user._id,
                userName: user.name,
                userRole: 'admin',
                admin: excelFile.uploadedBy._id,
                action: 'searched',
                vehicleNumber,
                vehicleId: vehicleId && mongoose.Types.ObjectId.isValid(vehicleId) ? vehicleId : null,
                excelFileId: excelFile._id,
                primaryAdminId: excelFile.uploadedBy._id,
                fileUploaderRole: uploaderRole,
                fileName: excelFile.originalName, // Primary admin sees real file name
                ipAddress,
                location,
                isOnline: true
              };
              notifications.push(primaryAdminNotificationData);

              // Notify primary admin's auditors
              const primaryAuditors = await User.find({
                createdBy: excelFile.uploadedBy._id,
                role: 'auditor',
                isActive: true
              });

              for (const auditor of primaryAuditors) {
                const auditorNotificationData = {
                  ...primaryAdminNotificationData,
                  admin: auditor._id,
                  fileName: excelFile.originalName // Auditors see real file name
                };
                notifications.push(auditorNotificationData);
              }
            }
          }

          if (notifications.length > 0) {
            await Notification.insertMany(notifications);
          }

          res.json({
            success: true,
            message: 'Action logged successfully',
            data: {
              notificationsCreated: notifications.length,
              action: 'searched',
              vehicleNumber
            }
          });
        }
      } else {
        // No file information - create basic notification
        if (user.role === 'fieldAgent' || user.role === 'auditor') {
          const userAdmin = await User.findById(user.createdBy);
          if (!userAdmin) {
            return res.status(400).json({
              success: false,
              message: 'User not assigned to any admin'
            });
          }

          const notificationData = {
            user: req.user._id,
            userName: user.name,
            userRole: user.role,
            admin: userAdmin._id,
            adminName: userAdmin.name, // Add admin name for field agent/auditor actions
            action,
            vehicleNumber,
            vehicleId: vehicleId && mongoose.Types.ObjectId.isValid(vehicleId) ? vehicleId : null,
            ipAddress,
            location,
            isOnline: isOnline !== undefined ? isOnline : true // Default to true if not provided (backward compatibility)
          };

          const notification = await Notification.create(notificationData);

          res.json({
            success: true,
            message: 'Action logged successfully',
            data: {
              id: notification._id,
              action,
              vehicleNumber
            }
          });
        } else {
          res.json({
            success: true,
            message: 'Action logged successfully',
            data: {
              action,
              vehicleNumber
            }
          });
        }
      }

    } catch (error) {
      console.error('Log action error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error logging action',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// @desc    Get notifications for admin
// @route   GET /api/notifications
// @access  Private (admin, superAdmin, superSuperAdmin, auditor)
router.get('/',
  authenticateToken,
  authorizeRole('admin', 'superAdmin', 'superSuperAdmin', 'auditor'),
  async (req, res) => {
    try {
      const { page = 1, limit = 50, unreadOnly = false, search = '' } = req.query;
      const skip = (page - 1) * limit;

      // Build query based on user role
      let query = {};
      
      if (req.user.role === 'admin') {
        // Admin sees only their team's notifications
        query.admin = req.user._id;
      } else if (req.user.role === 'auditor') {
        // Auditor sees EXACTLY the same notifications as their admin
        const auditorUser = await User.findById(req.user._id).select('createdBy');
        if (!auditorUser || !auditorUser.createdBy) {
          return res.status(400).json({
            success: false,
            message: 'Auditor not assigned to any admin'
          });
        }
        // Query notifications where admin = auditor's admin (same as admin sees)
        query.admin = auditorUser.createdBy;
        console.log('👁️ Auditor query - showing same notifications as admin:', { 
          auditorId: req.user._id, 
          adminId: auditorUser.createdBy 
        });
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
        // Combine search with existing query conditions using $and
        const searchCondition = {
          $or: [
            { vehicleNumber: { $regex: searchTerm, $options: 'i' } },
            { userName: { $regex: searchTerm, $options: 'i' } }
          ]
        };
        // If query already has conditions, use $and to combine
        if (Object.keys(query).length > 0) {
          query = { $and: [{ ...query }, searchCondition] };
        } else {
          query = searchCondition;
        }
        console.log('🔍 Search query:', { searchTerm });
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
      // Fetch primary admin names for notifications with maskedFileName but missing primaryAdminName (old notifications)
      const notificationsNeedingPrimaryAdmin = notifications.filter(n => 
        n.maskedFileName && !n.primaryAdminName && n.primaryAdminId
      );
      const primaryAdminIdsToFetch = [...new Set(notificationsNeedingPrimaryAdmin.map(n => n.primaryAdminId.toString()))];
      const primaryAdminsMap = new Map();
      if (primaryAdminIdsToFetch.length > 0) {
        const primaryAdmins = await User.find({ 
          _id: { $in: primaryAdminIdsToFetch.map(id => new mongoose.Types.ObjectId(id)) } 
        }).select('name _id').lean();
        primaryAdmins.forEach(admin => {
          primaryAdminsMap.set(admin._id.toString(), admin.name);
        });
      }

      const formattedNotifications = notifications.map(notif => {
        const locationText = notif.location && 
                             notif.location.city && 
                             notif.location.city !== 'Unknown'
          ? `${notif.location.city}${notif.location.region && notif.location.region !== 'Unknown' ? ', ' + notif.location.region : ''}`
          : notif.isOnline ? 'Location not available' : 'No Location (Offline)';

        // Get primary admin name - use stored value or fetch from map for old notifications
        let primaryAdminName = notif.primaryAdminName;
        if (!primaryAdminName && notif.maskedFileName && notif.primaryAdminId) {
          primaryAdminName = primaryAdminsMap.get(notif.primaryAdminId.toString()) || null;
        }

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
          ipAddress: notif.ipAddress,
          fileName: notif.fileName || null, // Real file name (if available)
          maskedFileName: notif.maskedFileName || null, // Masked file name (if available)
          excelFileId: notif.excelFileId,
          primaryAdminId: notif.primaryAdminId,
          primaryAdminName: primaryAdminName, // Primary admin name (for masked file notifications)
          fileUploaderRole: notif.fileUploaderRole,
          adminName: notif.adminName // Include admin name for field agent/auditor actions
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
// @access  Private (admin, superAdmin, superSuperAdmin, auditor)
router.put('/:id/read',
  authenticateToken,
  authorizeRole('admin', 'superAdmin', 'superSuperAdmin', 'auditor'),
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
      
      // Auditor can mark notifications for their admin
      if (req.user.role === 'auditor') {
        const auditorUser = await User.findById(req.user._id).select('createdBy');
        if (!auditorUser || !auditorUser.createdBy || !notification.admin.equals(auditorUser.createdBy)) {
          return res.status(403).json({
            success: false,
            message: 'Not authorized to mark this notification as read'
          });
        }
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
// @access  Private (admin, superAdmin, superSuperAdmin, auditor)
router.put('/mark-all-read',
  authenticateToken,
  authorizeRole('admin', 'superAdmin', 'superSuperAdmin', 'auditor'),
  async (req, res) => {
    try {
      let query = { isRead: false };
      
      if (req.user.role === 'admin') {
        query.admin = req.user._id;
      } else if (req.user.role === 'auditor') {
        // Auditor marks notifications for their admin (same as admin sees)
        const auditorUser = await User.findById(req.user._id).select('createdBy');
        if (!auditorUser || !auditorUser.createdBy) {
          return res.status(400).json({
            success: false,
            message: 'Auditor not assigned to any admin'
          });
        }
        query.admin = auditorUser.createdBy;
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
// @access  Private (admin, superAdmin, superSuperAdmin, auditor)
router.get('/stats',
  authenticateToken,
  authorizeRole('admin', 'superAdmin', 'superSuperAdmin', 'auditor'),
  async (req, res) => {
    try {
      let query = {};
      
      if (req.user.role === 'admin') {
        query.admin = req.user._id;
      } else if (req.user.role === 'auditor') {
        // Auditor sees stats for their admin (same as admin sees)
        const auditorUser = await User.findById(req.user._id).select('createdBy');
        if (!auditorUser || !auditorUser.createdBy) {
          return res.status(400).json({
            success: false,
            message: 'Auditor not assigned to any admin'
          });
        }
        query.admin = auditorUser.createdBy;
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
