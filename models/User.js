const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a name'],
    trim: true,
    maxlength: [50, 'Name cannot be more than 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Please add an email'],
    unique: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      'Please add a valid email'
    ]
  },
  phone: {
    type: String,
    required: [true, 'Please add a phone number'],
    unique: true,
    match: [/^[0-9]{10}$/, 'Please add a valid 10-digit phone number']
  },
  password: {
    type: String,
    required: [true, 'Please add a password'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false
  },
  role: {
    type: String,
    enum: ['superSuperAdmin', 'superAdmin', 'admin', 'fieldAgent', 'auditor'],
    default: 'fieldAgent'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: {
    type: Date,
    default: null
  },
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  profileImage: {
    type: String,
    default: null
  },
  location: {
    city: {
      type: String,
      required: [true, 'Please add a city']
    },
    state: {
      type: String,
      required: [true, 'Please add a state']
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      index: '2dsphere'
    }
  },

  lastLogin: {
    type: Date,
    default: null
  },
  loginHistory: [{
    timestamp: {
      type: Date,
      default: Date.now
    },
    ip: String,
    userAgent: String
  }],
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  emailVerified: {
    type: Boolean,
    default: false
  },
  phoneVerified: {
    type: Boolean,
    default: false
  },
  isOnline: {
    type: Boolean,
    default: false
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  // Session management fields for single-session-per-user
  currentSessionToken: {
    type: String,
    default: null
  },
  sessionCreatedAt: {
    type: Date,
    default: null
  },
  sessionExpiresAt: {
    type: Date,
    default: null
  },
  paymentRates: {
    auditorRate: {
      type: Number,
      default: 0,
      min: 0
    },
    fieldAgentRate: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  // Admin file sharing permission (requires super admin approval)
  canShareFiles: {
    type: Boolean,
    default: false
  },
  sharingPermissionApprovedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  sharingPermissionApprovedAt: {
    type: Date,
    default: null
  },
  // List of admin IDs that this admin is allowed to share files with (set by Super Admin)
  allowedSharingAdmins: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
}, {
  timestamps: true
});

// Create text index for search
userSchema.index({
  name: 'text',
  email: 'text',
  phone: 'text',
  'location.city': 'text',
  'location.state': 'text'
});

// Encrypt password using bcrypt
userSchema.pre('save', async function(next) {
  // Only hash password if it's been modified (not if it's already hashed)
  if (!this.isModified('password')) {
    return next(); // Return early if password hasn't changed
  }

  // Hash the password before saving
  const salt = await bcrypt.genSalt(parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12);
  this.password = await bcrypt.hash(this.password, salt);
  next(); // Call next() after hashing
});

// Generate a unique session token
userSchema.methods.generateSessionToken = function() {
  return crypto.randomBytes(32).toString('hex');
};

// Sign JWT and return with session token
userSchema.methods.getSignedJwtToken = function() {
  // Generate new session token
  const sessionToken = this.generateSessionToken();
  const expiresIn = process.env.JWT_EXPIRE || '30d';
  
  // Calculate expiration date
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + (expiresIn.includes('d') ? parseInt(expiresIn) : 30));
  
  // Update session info in user document
  this.currentSessionToken = sessionToken;
  this.sessionCreatedAt = new Date();
  this.sessionExpiresAt = expiresAt;
  this.isOnline = true;
  this.lastSeen = new Date();
  
  return jwt.sign(
    { 
      userId: this._id,
      sessionToken: sessionToken
    },
    process.env.JWT_SECRET,
    { expiresIn: expiresIn }
  );
};

// Match user entered password to hashed password in database
userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Generate and hash password token
userSchema.methods.getResetPasswordToken = function() {
  // Generate token
  const resetToken = crypto.randomBytes(20).toString('hex');

  // Hash token and set to resetPasswordToken field
  this.resetPasswordToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  // Set expire
  this.resetPasswordExpire = Date.now() + 10 * 60 * 1000; // 10 minutes

  return resetToken;
};

// Invalidate current session
userSchema.methods.invalidateSession = function() {
  this.currentSessionToken = null;
  this.sessionCreatedAt = null;
  this.sessionExpiresAt = null;
  this.isOnline = false;
  this.lastSeen = new Date();
};

// Virtual for user's full name
userSchema.virtual('fullName').get(function() {
  return `${this.name}`;
});

// Virtual for user's location string
userSchema.virtual('locationString').get(function() {
  return `${this.location.city}, ${this.location.state}`;
});

// Ensure virtual fields are serialized
userSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    delete ret.password;
    delete ret.resetPasswordToken;
    delete ret.resetPasswordExpire;
    delete ret.currentSessionToken;
    return ret;
  }
});

module.exports = mongoose.model('User', userSchema); 