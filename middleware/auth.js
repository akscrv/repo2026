const jwt = require('jsonwebtoken');
const User = require('../models/User');
const mongoose = require('mongoose');

// Middleware to authenticate JWT token
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user from database with session info
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    // Check if user's admin is active (for field agents and auditors)
    if ((user.role === 'fieldAgent' || user.role === 'auditor') && user.createdBy) {
      const admin = await User.findById(user.createdBy).select('isActive');
      if (!admin || !admin.isActive) {
        return res.status(401).json({
          success: false,
          message: 'Your admin account is deactivated. Please contact support.'
        });
      }
    }

    // Validate session token for single-session-per-user
    // Admin role can have multiple simultaneous sessions, so skip strict validation
    if (user.role !== 'admin') {
      // For non-admin roles, enforce single session
      if (!user.currentSessionToken || !decoded.sessionToken) {
        return res.status(401).json({
          success: false,
          message: 'Session expired. Please login again.'
        });
      }

      // Check if session token matches
      if (user.currentSessionToken !== decoded.sessionToken) {
        return res.status(401).json({
          success: false,
          message: 'Session invalidated. You have been logged out from another device.'
        });
      }

      // Check if session has expired
      if (user.sessionExpiresAt && new Date() > user.sessionExpiresAt) {
        return res.status(401).json({
          success: false,
          message: 'Session expired. Please login again.'
        });
      }
    } else {
      // For admin role, only check if token is expired (allow multiple sessions)
      if (user.sessionExpiresAt && new Date() > user.sessionExpiresAt) {
        return res.status(401).json({
          success: false,
          message: 'Session expired. Please login again.'
        });
      }
    }

    // Update last seen (but not online status on every request)
    await User.findByIdAndUpdate(user._id, {
      lastSeen: new Date()
    });

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  }
};

// Middleware to check if user has required role
const authorizeRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Debug logging
    const userRole = req.user.role;
    const hasAccess = roles.includes(userRole);
    
    console.log('🔐 Authorization check:', {
      userRole: userRole,
      userRoleType: typeof userRole,
      userRoleLength: userRole ? userRole.length : 0,
      requiredRoles: roles,
      hasAccess: hasAccess,
      route: req.path || req.url
    });

    if (!hasAccess) {
      console.error('❌ Access denied for role:', userRole, 'Required:', roles);
      return res.status(403).json({
        success: false,
        message: 'Access denied. Insufficient permissions.',
        debug: process.env.NODE_ENV === 'development' ? {
          userRole: userRole,
          requiredRoles: roles
        } : undefined
      });
    }

    next();
  };
};

// Middleware to check if user can access specific resource
const authorizeResource = (resourceType) => {
  return async (req, res, next) => {
    try {
      const userId = req.user._id;
      const resourceId = req.params.id;

      // Super super admin, super admin and admin can access all resources
      if (['superSuperAdmin', 'superAdmin', 'admin'].includes(req.user.role)) {
        return next();
      }

      // For field agents, check if they own the resource
      if (req.user.role === 'fieldAgent') {
        const resource = await mongoose.model(resourceType).findById(resourceId);
        
        if (!resource) {
          return res.status(404).json({
            success: false,
            message: 'Resource not found'
          });
        }

        // Check if the resource belongs to the user
        if (resource.assignedTo && resource.assignedTo.toString() !== userId.toString()) {
          return res.status(403).json({
            success: false,
            message: 'Access denied. You can only access your assigned resources.'
          });
        }
      }

      next();
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Authorization error'
      });
    }
  };
};

module.exports = {
  authenticateToken,
  authorizeRole,
  authorizeResource
}; 