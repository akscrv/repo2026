const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { body, validationResult } = require('express-validator');
const MoneyRecord = require('../models/MoneyRecord');
const MoneyExcelFile = require('../models/MoneyExcelFile');
// ✅ PRODUCTION: ExcelVehicle removed - vehicle lookup uses VehicleLookup + GCS via /excel/vehicles/by-reg endpoint
const { authenticateToken, authorizeRole } = require('../middleware/auth');

// Configure multer for Excel file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, '..', 'uploads', 'money');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'money-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx files are allowed'));
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// Required Excel headers (exact match, case-sensitive)
const REQUIRED_HEADERS = [
  'Bill Date',
  'Bank', 
  'RegistrationNumber',
  'Make',
  'Model',
  'STATUS',
  'Yard Name',
  'Repo Bill Amount',
  'Repo Payment Status',
  'Total Bill Amount',
  'Loan Number',
  'Customer Name',
  'Load',
  'Load Details',
  'Confirm By',
  'Repo Date',
  'ServiceTax',
  'Payment To Repo Team'
];

// Validation rules for money record
const moneyRecordValidation = [
  body('registration_number').trim().notEmpty().withMessage('Registration number is required'),
  body('bill_date').isISO8601().withMessage('Valid bill date is required'),
  body('bank').trim().notEmpty().withMessage('Bank is required'),
  body('make').trim().notEmpty().withMessage('Make is required'),
  body('model').trim().notEmpty().withMessage('Model is required'),
  body('status').trim().notEmpty().withMessage('Status is required'),
  body('yard_name').trim().notEmpty().withMessage('Yard name is required'),
  body('repo_bill_amount').isNumeric().withMessage('Repo bill amount must be a number'),
  body('total_bill_amount').isNumeric().withMessage('Total bill amount must be a number'),
  body('loan_number').trim().notEmpty().withMessage('Loan number is required'),
  body('customer_name').trim().notEmpty().withMessage('Customer name is required'),
  body('confirmed_by').trim().notEmpty().withMessage('Confirmed by is required'),
  body('repo_date').isISO8601().withMessage('Valid repo date is required'),
  body('service_tax').optional().isNumeric().withMessage('Service tax must be a number'),
  body('payment_to_repo_team').optional().isNumeric().withMessage('Payment to repo team must be a number')
];

// Helper function to parse date with timezone
function parseDate(dateStr, timezone = 'Asia/Kolkata') {
  if (!dateStr) return null;
  
  // Handle Excel date serial numbers
  if (typeof dateStr === 'number') {
    const excelEpoch = new Date(1900, 0, 1);
    const days = dateStr - 2; // Excel counts from 1900-01-01, but has leap year bug
    return new Date(excelEpoch.getTime() + days * 24 * 60 * 60 * 1000);
  }
  
  // Handle string dates
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

// Helper function to get admin's data count for super admins
async function getAdminDataCounts() {
  const adminCounts = await MoneyRecord.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'created_by',
        foreignField: '_id',
        as: 'creator'
      }
    },
    {
      $unwind: '$creator'
    },
    {
      $group: {
        _id: '$creator._id',
        adminName: { $first: '$creator.name' },
        adminEmail: { $first: '$creator.email' },
        count: { $sum: 1 }
      }
    },
    {
      $sort: { count: -1 }
    }
  ]);
  
  return adminCounts;
}

// @desc    Get money records with search, filters, and pagination
// @route   GET /api/money
// @access  Private (Admin, Auditor, SuperAdmin, SuperSuperAdmin, FieldAgent)
router.get('/', 
  authenticateToken, 
  authorizeRole('admin', 'auditor', 'superAdmin', 'superSuperAdmin', 'fieldAgent'),
  async (req, res) => {
    try {
      const {
        search = '',
        bank = '',
        status = '',
        repo_payment_status = '',
        from = '',
        to = '',
        page = 1,
        limit = 20,
        sort = '-bill_date'
      } = req.query;

      // For Super Admins, return admin data counts
      if (req.user.role === 'superAdmin' || req.user.role === 'superSuperAdmin') {
        const adminCounts = await getAdminDataCounts();
        return res.json({
          success: true,
          isAdminView: true,
          adminCounts,
          total: adminCounts.reduce((sum, admin) => sum + admin.count, 0)
        });
      }

      // Build query
      let query = {};
      
      // Role-based filtering
      if (req.user.role === 'admin') {
        query.created_by = req.user._id;
      } else if (req.user.role === 'auditor') {
        // Auditors can see money records created by their admin
        query.created_by = req.user.adminId;
      } else if (req.user.role === 'fieldAgent') {
        // Field agents can see money records assigned to them
        query.field_agent = req.user._id;
      }

      // Search across multiple fields
      if (search) {
        const searchRegex = new RegExp(search, 'i');
        query.$or = [
          { registration_number: searchRegex },
          { bank: searchRegex },
          { customer_name: searchRegex },
          { loan_number: searchRegex },
          { confirmed_by: searchRegex }
        ];
      }

      // Filters
      if (bank) {
        query.bank = new RegExp(bank, 'i');
      }
      if (status) {
        query.status = new RegExp(status, 'i');
      }
      if (repo_payment_status) {
        query.repo_payment_status = new RegExp(repo_payment_status, 'i');
      }

      // Date range filter
      if (from || to) {
        query.bill_date = {};
        if (from) query.bill_date.$gte = new Date(from);
        if (to) query.bill_date.$lte = new Date(to + 'T23:59:59.999Z');
      }

      // Pagination
      const pageNum = parseInt(page) || 1;
      const pageSize = parseInt(limit) || 20;
      const skip = (pageNum - 1) * pageSize;

      // Sort
      let sortObj = {};
      if (sort.startsWith('-')) {
        sortObj[sort.substring(1)] = -1;
      } else {
        sortObj[sort] = 1;
      }

      // Execute query
      const [records, total] = await Promise.all([
        MoneyRecord.find(query)
          .populate('created_by', 'name email')
          .populate('updated_by', 'name email')
          .populate('field_agent', 'name email phone')
          .sort(sortObj)
          .skip(skip)
          .limit(pageSize)
          .lean(),
        MoneyRecord.countDocuments(query)
      ]);

      res.json({
        success: true,
        data: records,
        pagination: {
          current: pageNum,
          pages: Math.ceil(total / pageSize),
          total,
          hasNext: pageNum < Math.ceil(total / pageSize),
          hasPrev: pageNum > 1
        }
      });

    } catch (error) {
      console.error('Error fetching money records:', error);
      res.status(500).json({
        success: false,
        message: 'Server error while fetching money records'
      });
    }
  }
);

// @desc    Export money records to Excel
// @route   GET /api/money/export
// @access  Private (Admin, Auditor, FieldAgent)
router.get('/export',
  authenticateToken,
  authorizeRole('admin', 'auditor', 'fieldAgent'),
  async (req, res) => {
    try {
      const {
        search = '',
        bank = '',
        status = '',
        repo_payment_status = '',
        from = '',
        to = ''
      } = req.query;

      // Build query (same as GET route)
      let query;
      if (req.user.role === 'admin') {
        query = { created_by: req.user._id };
      } else if (req.user.role === 'auditor') {
        query = { created_by: req.user.adminId };
      } else if (req.user.role === 'fieldAgent') {
        query = { field_agent: req.user._id };
      }

      if (search) {
        const searchRegex = new RegExp(search, 'i');
        query.$or = [
          { registration_number: searchRegex },
          { bank: searchRegex },
          { customer_name: searchRegex },
          { loan_number: searchRegex },
          { confirmed_by: searchRegex }
        ];
      }

      if (bank) query.bank = new RegExp(bank, 'i');
      if (status) query.status = new RegExp(status, 'i');
      if (repo_payment_status) query.repo_payment_status = new RegExp(repo_payment_status, 'i');

      if (from || to) {
        query.bill_date = {};
        if (from) query.bill_date.$gte = new Date(from);
        if (to) query.bill_date.$lte = new Date(to + 'T23:59:59.999Z');
      }

      // Fetch records
      const records = await MoneyRecord.find(query)
        .sort({ bill_date: -1 })
        .lean();

      // Prepare Excel data - EXACT same format and order as import headers
      const excelData = records.map(record => {
        const row = {};
        
        // Use the EXACT SAME order as REQUIRED_HEADERS for import compatibility
        REQUIRED_HEADERS.forEach(header => {
          switch(header) {
            case 'Bill Date':
              row[header] = record.bill_date.toISOString().split('T')[0];
              break;
            case 'Bank':
              row[header] = record.bank || '';
              break;
            case 'RegistrationNumber':
              row[header] = record.registration_number || '';
              break;
            case 'Make':
              row[header] = record.make || '';
              break;
            case 'Model':
              row[header] = record.model || '';
              break;
            case 'STATUS':
              row[header] = record.status || '';
              break;
            case 'Yard Name':
              row[header] = record.yard_name || '';
              break;
            case 'Repo Bill Amount':
              row[header] = record.repo_bill_amount || 0;
              break;
            case 'Repo Payment Status':
              row[header] = record.repo_payment_status || 'Payment Due';
              break;
            case 'Total Bill Amount':
              row[header] = record.total_bill_amount || 0;
              break;
            case 'Loan Number':
              row[header] = record.loan_number || '';
              break;
            case 'Customer Name':
              row[header] = record.customer_name || '';
              break;
            case 'Load':
              row[header] = record.load || '';
              break;
            case 'Load Details':
              row[header] = record.load_details || '';
              break;
            case 'Confirm By':
              row[header] = record.confirmed_by || '';
              break;
            case 'Repo Date':
              row[header] = record.repo_date.toISOString().split('T')[0];
              break;
            case 'ServiceTax':
              row[header] = record.service_tax || 0;
              break;
            case 'Payment To Repo Team':
              row[header] = record.payment_to_repo_team || 0;
              break;
          }
        });
        
        return row;
      });

      // Create workbook
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(excelData);
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Money Records');

      // Generate filename
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `money-records-${timestamp}.xlsx`;

      // Set response headers
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      // Write and send file
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      res.send(buffer);

    } catch (error) {
      console.error('Error exporting money records:', error);
      res.status(500).json({
        success: false,
        message: 'Server error while exporting money records'
      });
    }
  }
);

// @desc    Get single money record
// @route   GET /api/money/:id
// @access  Private (Admin, Auditor, SuperAdmin, SuperSuperAdmin, FieldAgent)
router.get('/:id',
  authenticateToken,
  authorizeRole('admin', 'auditor', 'superAdmin', 'superSuperAdmin', 'fieldAgent'),
  async (req, res) => {
    try {
      const record = await MoneyRecord.findById(req.params.id)
        .populate('created_by', 'name email')
        .populate('updated_by', 'name email')
        .populate('field_agent', 'name email phone')
        .populate('source_excel_file_id', 'originalName filename');

      if (!record) {
        return res.status(404).json({
          success: false,
          message: 'Money record not found'
        });
      }

      // Check access permissions
      if (req.user.role === 'admin' && 
          record.created_by._id.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to this record'
        });
      } else if (req.user.role === 'auditor' && 
                 record.created_by._id.toString() !== req.user.adminId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to this record'
        });
      } else if (req.user.role === 'fieldAgent' && 
                 record.field_agent && record.field_agent._id.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to this record'
        });
      }

      res.json({
        success: true,
        data: record
      });

    } catch (error) {
      console.error('Error fetching money record:', error);
      res.status(500).json({
        success: false,
        message: 'Server error while fetching money record'
      });
    }
  }
);

// @desc    Create new money record
// @route   POST /api/money
// @access  Private (Admin, Auditor only - Field agents cannot create)
router.post('/',
  authenticateToken,
  authorizeRole('admin', 'auditor'),
  moneyRecordValidation,
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

      const recordData = {
        ...req.body,
        registration_number: req.body.registration_number.toUpperCase().trim(),
        created_by: req.user.role === 'auditor' ? req.user.adminId : req.user._id,
        updated_by: req.user._id
      };

      const record = new MoneyRecord(recordData);
      await record.save();

      const populatedRecord = await MoneyRecord.findById(record._id)
        .populate('created_by', 'name email')
        .populate('updated_by', 'name email');

      res.status(201).json({
        success: true,
        message: 'Money record created successfully',
        data: populatedRecord
      });

    } catch (error) {
      console.error('Error creating money record:', error);
      res.status(500).json({
        success: false,
        message: 'Server error while creating money record'
      });
    }
  }
);

// @desc    Update money record
// @route   PUT /api/money/:id
// @access  Private (Admin, Auditor only - Field agents cannot edit)
router.put('/:id',
  authenticateToken,
  authorizeRole('admin', 'auditor'),
  moneyRecordValidation,
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

      const record = await MoneyRecord.findById(req.params.id);
      
      if (!record) {
        return res.status(404).json({
          success: false,
          message: 'Money record not found'
        });
      }

      // Check permissions
      if (req.user.role === 'admin' && record.created_by.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to update this record'
        });
      } else if (req.user.role === 'auditor' && record.created_by.toString() !== req.user.adminId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to update this record'
        });
      }

      const updateData = {
        ...req.body,
        registration_number: req.body.registration_number.toUpperCase().trim(),
        updated_by: req.user._id
      };

      const updatedRecord = await MoneyRecord.findByIdAndUpdate(
        req.params.id,
        updateData,
        { new: true, runValidators: true }
      )
      .populate('created_by', 'name email')
      .populate('updated_by', 'name email');

      res.json({
        success: true,
        message: 'Money record updated successfully',
        data: updatedRecord
      });

    } catch (error) {
      console.error('Error updating money record:', error);
      res.status(500).json({
        success: false,
        message: 'Server error while updating money record'
      });
    }
  }
);

// @desc    Delete all money records
// @route   DELETE /api/money/delete-all
// @access  Private (Admin, Auditor only - not super admins or field agents)
router.delete('/delete-all',
  authenticateToken,
  authorizeRole('admin', 'auditor'),
  async (req, res) => {
    try {
      // For admin/auditor - only delete their own records
      let deleteQuery;
      if (req.user.role === 'admin') {
        deleteQuery = { created_by: req.user._id };
      } else if (req.user.role === 'auditor') {
        deleteQuery = { created_by: req.user.adminId };
      }
      
      // Get count before deletion for confirmation
      const totalCount = await MoneyRecord.countDocuments(deleteQuery);
      
      if (totalCount === 0) {
        return res.json({
          success: true,
          message: 'No records found to delete',
          deletedCount: 0
        });
      }

      // Perform the deletion
      const result = await MoneyRecord.deleteMany(deleteQuery);

      res.json({
        success: true,
        message: `Successfully deleted ${result.deletedCount} money records`,
        deletedCount: result.deletedCount
      });

    } catch (error) {
      console.error('Error deleting all money records:', error);
      res.status(500).json({
        success: false,
        message: 'Server error while deleting all money records'
      });
    }
  }
);

// @desc    Delete money record
// @route   DELETE /api/money/:id
// @access  Private (Admin, Auditor only - Field agents cannot delete)
router.delete('/:id',
  authenticateToken,
  authorizeRole('admin', 'auditor'),
  async (req, res) => {
    try {
      const record = await MoneyRecord.findById(req.params.id);
      
      if (!record) {
        return res.status(404).json({
          success: false,
          message: 'Money record not found'
        });
      }

      // Check permissions
      if (req.user.role === 'admin' && record.created_by.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to delete this record'
        });
      } else if (req.user.role === 'auditor' && record.created_by.toString() !== req.user.adminId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to delete this record'
        });
      }

      await MoneyRecord.findByIdAndDelete(req.params.id);

      res.json({
        success: true,
        message: 'Money record deleted successfully'
      });

    } catch (error) {
      console.error('Error deleting money record:', error);
      res.status(500).json({
        success: false,
        message: 'Server error while deleting money record'
      });
    }
  }
);

// @desc    Import money records from Excel
// @route   POST /api/money/import
// @access  Private (Admin, Auditor)
router.post('/import',
  authenticateToken,
  authorizeRole('admin', 'auditor'),
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Excel file is required'
        });
      }

      const { dedupe = 'false' } = req.body;
      const dedupeEnabled = dedupe === 'true';

      // Create MoneyExcelFile record
      const excelFile = new MoneyExcelFile({
        filename: req.file.filename,
        originalName: req.file.originalname,
        uploadedBy: req.user.role === 'auditor' ? req.user.adminId : req.user._id,
        dedupeEnabled,
        status: 'processing'
      });
      await excelFile.save();

      // Process Excel file with streaming approach
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
        await MoneyExcelFile.findByIdAndUpdate(excelFile._id, {
          status: 'failed',
          errorMessage: 'Excel file is empty or has no data rows'
        });
        return res.status(400).json({
          success: false,
          message: 'Excel file is empty or has no data rows'
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
      const missingHeaders = REQUIRED_HEADERS.filter(header => !headers.includes(header));
      
      if (missingHeaders.length > 0) {
        await MoneyExcelFile.findByIdAndUpdate(excelFile._id, {
          status: 'failed',
          errorMessage: `Missing required headers: ${missingHeaders.join(', ')}`
        });
        return res.status(400).json({
          success: false,
          message: `Missing required headers: ${missingHeaders.join(', ')}`,
          expectedHeaders: REQUIRED_HEADERS,
          actualHeaders
        });
      }

      // Process rows in streaming chunks
      let insertedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      const errors = [];
      const chunkSize = 1000; // Process 1000 rows at a time

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
          const rowData = {};
          for (let col = range.s.c; col <= range.e.c; col++) {
            const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
            const cell = worksheet[cellAddress];
            const headerName = headers[col];
            if (headerName) {
              rowData[headerName] = cell ? cell.v : null;
            }
          }
          chunkData.push(rowData);
        }

        // Process this chunk
        for (let i = 0; i < chunkData.length; i++) {
          const rowData = chunkData[i];
          const rowNumber = startRow + i + 1; // +1 because we start from row 2 (after header)
        
        try {
          // Parse and validate data
          const recordData = {
            registration_number: (rowData['RegistrationNumber'] || '').toString().toUpperCase().trim(),
            bill_date: parseDate(rowData['Bill Date']),
            bank: (rowData['Bank'] || '').toString().trim(),
            make: (rowData['Make'] || '').toString().trim(),
            model: (rowData['Model'] || '').toString().trim(),
            status: (rowData['STATUS'] || '').toString().trim(),
            yard_name: (rowData['Yard Name'] || '').toString().trim(),
            repo_bill_amount: parseFloat(rowData['Repo Bill Amount']) || 0,
            repo_payment_status: (rowData['Repo Payment Status'] || 'Payment Due').toString().trim(),
            total_bill_amount: parseFloat(rowData['Total Bill Amount']) || 0,
            loan_number: (rowData['Loan Number'] || '').toString().trim(),
            customer_name: (rowData['Customer Name'] || '').toString().trim(),
            load: (rowData['Load'] || '').toString().trim(),
            load_details: (rowData['Load Details'] || '').toString().trim(),
            confirmed_by: (rowData['Confirm By'] || '').toString().trim(),
            repo_date: parseDate(rowData['Repo Date']),
            service_tax: parseFloat(rowData['ServiceTax']) || 0,
            payment_to_repo_team: parseFloat(rowData['Payment To Repo Team']) || 0,
            created_by: req.user.role === 'auditor' ? req.user.adminId : req.user._id,
            updated_by: req.user._id,
            source_excel_file_id: excelFile._id
          };

          // Validate required fields
          if (!recordData.registration_number || !recordData.bill_date || !recordData.bank) {
            errors.push({
              row: i + 2, // +2 because Excel starts from 1 and header is row 1
              reason: 'Missing required fields: registration_number, bill_date, or bank'
            });
            skippedCount++;
            continue;
          }

          if (dedupeEnabled) {
            // Deduplication logic - find existing record first, then update or create
            const billMonth = recordData.bill_date.toISOString().substring(0, 7); // YYYY-MM
            
            // Create date range for the month
            const startOfMonth = new Date(billMonth + '-01');
            const endOfMonth = new Date(startOfMonth);
            endOfMonth.setMonth(endOfMonth.getMonth() + 1);
            endOfMonth.setDate(0); // Last day of month
            endOfMonth.setHours(23, 59, 59, 999);

            // Find existing record using date range (MongoDB-friendly)
            const existingRecord = await MoneyRecord.findOne({
              registration_number: recordData.registration_number,
              bank: recordData.bank,
              bill_date: {
                $gte: startOfMonth,
                $lte: endOfMonth
              }
            });

            if (existingRecord) {
              // Update existing record
              await MoneyRecord.findByIdAndUpdate(
                existingRecord._id,
                recordData,
                { runValidators: true }
              );
              updatedCount++;
            } else {
              // Create new record
              const record = new MoneyRecord(recordData);
              await record.save();
              insertedCount++;
            }
          } else {
            // Always insert (allow duplicates)
            const record = new MoneyRecord(recordData);
            await record.save();
            insertedCount++;
          }

        } catch (error) {
          console.error(`Row ${rowNumber} error:`, error.message);
          errors.push({
            row: rowNumber,
            reason: error.message
          });
          skippedCount++;
        }
      }

      // Update progress every 5 chunks
      if ((Math.floor(startRow / chunkSize) + 1) % 5 === 0 || endRow >= totalRows - 1) {
        await MoneyExcelFile.findByIdAndUpdate(excelFile._id, {
          totalRows: totalRows - 1, // Exclude header row
          processedRows: insertedCount + updatedCount,
          insertedRows: insertedCount,
          updatedRows: updatedCount,
          skippedRows: skippedCount,
          failedRows: errors.length,
          status: 'processing',
          errors: errors.slice(0, 100), // Limit errors array
          errorMessage: errors.length > 0 ? `${errors.length} rows failed processing` : null
        });
      }

      // Force garbage collection every 10 chunks to free memory
      if ((Math.floor(startRow / chunkSize) + 1) % 10 === 0) {
        if (global.gc) {
          global.gc();
        }
      }
    }

    // Update file status with final results
    const status = errors.length === 0 ? 'completed' : 
                 (insertedCount + updatedCount === 0 ? 'failed' : 'partial');

    await MoneyExcelFile.findByIdAndUpdate(excelFile._id, {
      totalRows: totalRows - 1, // Exclude header row
      processedRows: insertedCount + updatedCount,
      insertedRows: insertedCount,
      updatedRows: updatedCount,
      skippedRows: skippedCount,
      failedRows: errors.length,
      status,
      errors: errors.slice(0, 100), // Limit errors array
      errorMessage: errors.length > 0 ? `${errors.length} rows failed processing` : null
    });

      // Cleanup uploaded file
      fs.unlinkSync(req.file.path);

      res.status(201).json({
        success: true,
        message: 'Excel file processed successfully',
        data: {
          fileId: excelFile._id,
          filename: req.file.originalname,
          totalRows: totalRows - 1, // Exclude header row
          insertedCount,
          updatedCount,
          skippedCount,
          failedCount: errors.length,
          errors: errors.slice(0, 10), // Return first 10 errors
          dedupeEnabled
        }
      });

    } catch (error) {
      console.error('Error importing money records:', error);
      
      // Cleanup file on error
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      res.status(500).json({
        success: false,
        message: 'Server error while importing money records'
      });
    }
  }
);

module.exports = router;
