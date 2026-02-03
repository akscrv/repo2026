const mongoose = require('mongoose');

const excelVehicleSchema = new mongoose.Schema({
  excel_file: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ExcelFile',
    required: [true, 'Excel file reference is required']
  },
  registration_number: {
    type: String,
    maxlength: 100,
    default: null
  },
  first_confirmer_name: {
    type: String,
    maxlength: 100,
    default: null
  },
  first_confirmer_no: {
    type: String,
    maxlength: 20,
    default: null
  },
  second_confirmer_name: {
    type: String,
    maxlength: 100,
    default: null
  },
  second_confirmer_no: {
    type: String,
    maxlength: 20,
    default: null
  },
  third_confirmer_name: {
    type: String,
    maxlength: 100,
    default: null
  },
  third_confirmer_no: {
    type: String,
    maxlength: 20,
    default: null
  },
  loan_number: {
    type: String,
    maxlength: 100,
    default: null
  },
  make: {
    type: String,
    maxlength: 100,
    default: null
  },
  chasis_number: {
    type: String,
    maxlength: 100,
    default: null
  },
  engine_number: {
    type: String,
    maxlength: 100,
    default: null
  },
  emi: {
    type: String,
    maxlength: 100,
    default: null
  },
  pos: {
    type: String,
    maxlength: 100,
    default: null
  },
  bucket: {
    type: String,
    maxlength: 100,
    default: null
  },
  customer_name: {
    type: String,
    maxlength: 100,
    default: null
  },
  address: {
    type: String,
    maxlength: 255,
    default: null
  },
  branch: {
    type: String,
    maxlength: 100,
    default: null
  },
  sec_17: {
    type: String,
    maxlength: 100,
    default: null
  },
  seasoning: {
    type: String,
    maxlength: 100,
    default: null
  },
  tbr: {
    type: String,
    maxlength: 100,
    default: null
  },
  allocation: {
    type: String,
    maxlength: 100,
    default: null
  },
  model: {
    type: String,
    maxlength: 100,
    default: null
  },
  product_name: {
    type: String,
    maxlength: 100,
    default: null
  },
  rowNumber: {
    type: Number,
    required: [true, 'Row number is required']
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// OPTIMIZED INDEXES - Only for registration_number and chasis_number search fields
excelVehicleSchema.index({ excel_file: 1, isActive: 1 }); // For listing vehicles by file
excelVehicleSchema.index({ isActive: 1, excel_file: 1 }); // Reverse order for different queries

// Individual field indexes for search (sparse = faster, only indexes non-null values)
excelVehicleSchema.index({ registration_number: 1, isActive: 1 }, { 
  sparse: true,
  background: true,
  name: 'reg_search_idx'
});
excelVehicleSchema.index({ chasis_number: 1, isActive: 1 }, { 
  sparse: true,
  background: true,
  name: 'chasis_search_idx'
});

// Compound index for multi-field searches (registration_number + chasis_number)
excelVehicleSchema.index({ 
  registration_number: 1, 
  chasis_number: 1, 
  isActive: 1 
}, { sparse: true, name: 'reg_chasis_idx' });

// Recent uploads index
excelVehicleSchema.index({ createdAt: -1, excel_file: 1, isActive: 1 });

module.exports = mongoose.model('ExcelVehicle', excelVehicleSchema); 