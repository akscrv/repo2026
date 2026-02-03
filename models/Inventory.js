const mongoose = require('mongoose');

const inventorySchema = new mongoose.Schema({
  // Auto-generated fields (from vehicle data)
  vehicleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'VehicleLookup', // ✅ Updated: References VehicleLookup instead of ExcelVehicle
    required: true
  },
  registrationNumber: {
    type: String,
    required: true
  },
  customerName: {
    type: String,
    required: true
  },
  make: {
    type: String,
    required: true
  },
  chasisNumber: {
    type: String,
    required: true
  },
  engineNumber: {
    type: String,
    required: true
  },

  // Field Agent Information
  fieldAgentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  fieldAgentName: {
    type: String,
    required: true
  },
  fieldAgentPhone: {
    type: String,
    required: true
  },

  // Admin Information
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  adminName: {
    type: String,
    required: true
  },

  // Manual entry fields
  driverName: {
    type: String,
    required: true
  },
  driverNumber: {
    type: String,
    required: true
  },

  // Optional fields
  speedMeterReading: {
    type: String
  },
  originalRCBook: {
    type: String,
    enum: ['yes', 'no']
  },
  insurancePolicyUpto: {
    type: Date
  },
  parkingYardName: {
    type: String
  },
  parkingExpensesPerDay: {
    type: String
  },
  keyAvailability: {
    type: String,
    enum: ['yes', 'no']
  },
  tyreConditionFront: {
    type: String,
    enum: ['good', 'average', 'bad']
  },
  tyreConditionRear: {
    type: String,
    enum: ['good', 'average', 'bad']
  },
  tyreMake: {
    type: String
  },
  bodyType: {
    type: String
  },
  bodyCondition: {
    type: String,
    enum: ['good', 'average', 'bad']
  },
  numberOfWheels: {
    type: String
  },
  airConditioner: {
    type: String,
    enum: ['available', 'not available']
  },
  jockeyWithRod: {
    type: String,
    enum: ['available', 'not available']
  },
  toolSet: {
    type: String,
    enum: ['available', 'not available']
  },
  rearViewMirror: {
    type: String,
    enum: ['available', 'not available']
  },
  stephnee: {
    type: String,
    enum: ['available', 'not available']
  },
  tarpaulinRope: {
    type: String,
    enum: ['available', 'not available']
  },
  tutorAmplifier: {
    type: String,
    enum: ['available', 'not available']
  },
  stereoSet: {
    type: String,
    enum: ['available', 'not available']
  },
  battery: {
    type: String,
    enum: ['available', 'not available']
  },
  seatCovers: {
    type: String,
    enum: ['available', 'not available']
  },
  wiper: {
    type: String,
    enum: ['available', 'not available']
  },
  otherSpecificItems: {
    type: String
  },

  // Metadata
  seizureDate: {
    type: Date,
    default: Date.now
  },
  inventoryNumber: {
    type: String,
    unique: true
  }
}, {
  timestamps: true
});

// Generate inventory number before saving
inventorySchema.pre('save', async function(next) {
  if (this.isNew) {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    // Get count of inventories for today
    const todayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const todayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    
    const count = await this.constructor.countDocuments({
      createdAt: { $gte: todayStart, $lt: todayEnd }
    });
    
    this.inventoryNumber = `INV-${year}${month}${day}-${String(count + 1).padStart(3, '0')}`;
  }
  next();
});

// Indexes for efficient queries
inventorySchema.index({ fieldAgentId: 1, createdAt: -1 });
inventorySchema.index({ adminId: 1, createdAt: -1 });
inventorySchema.index({ vehicleId: 1 });
inventorySchema.index({ inventoryNumber: 1 });

module.exports = mongoose.model('Inventory', inventorySchema);
