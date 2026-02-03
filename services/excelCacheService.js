const XLSX = require('xlsx');
const { getFileBufferFromGCS } = require('./gcsService');

/**
 * Excel Cache Service
 * Caches parsed Excel files in memory to avoid re-parsing GCS files
 * This dramatically speeds up search results that need full vehicle data
 */

// IN-MEMORY CACHE: Does NOT use MongoDB storage
// All Excel file caching is stored in Node.js memory (Map object) - cleared on server restart
// This dramatically speeds up searches without increasing MongoDB storage
// Cache structure: { gcsFileUrl: { data: [...rows], regIndex: Map, chassisIndex: Map, timestamp: Date } }
const excelCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours - Excel files don't change often

/**
 * Get full vehicle data from Excel file (cached)
 * @param {string} gcsFileUrl - GCS URL of Excel file
 * @param {number} rowNumber - Row number (1-based, excluding header)
 * @returns {Promise<Object>} Vehicle data object with all fields
 */
async function getVehicleDataFromExcel(gcsFileUrl, rowNumber) {
  try {
    // Check cache first
    const cached = excelCache.get(gcsFileUrl);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      // Cache hit - return row data
      // IMPORTANT: rowNumber = row + 1 where row starts from 1 (Excel row 2, first data row)
      // So: Excel row 2 -> rowNumber = 2, and rows[0] = Excel row 2
      // Therefore: rows[rowNumber - 2] gives us the correct row
      const arrayIndex = rowNumber - 2;
      const rowData = arrayIndex >= 0 && arrayIndex < cached.data.length ? cached.data[arrayIndex] : null;
      if (rowData) {
        return rowData;
      }
      throw new Error(`Row ${rowNumber} not found in cached Excel file (arrayIndex: ${arrayIndex}, total rows: ${cached.data.length})`);
    }

    // Cache miss - fetch and parse Excel file from GCS
    const fetchStartTime = Date.now();
    console.log(`📥 Fetching Excel file from GCS: ${gcsFileUrl}`);
    const buffer = await getFileBufferFromGCS(gcsFileUrl);
    const fetchTime = Date.now() - fetchStartTime;
    console.log(`⏱️  GCS fetch time: ${fetchTime}ms`);
    
    // Parse Excel file
    const workbook = XLSX.read(buffer, {
      cellDates: true,
      cellNF: false,
      cellText: false,
      cellStyles: false
    });
    
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Get headers
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    const headers = [];
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
      const cell = worksheet[cellAddress];
      headers[col] = cell ? cell.v : null;
    }

    // Parse all rows into array of objects
    const rows = [];
    for (let row = 1; row <= range.e.r; row++) {
      const rowData = {};
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        const cell = worksheet[cellAddress];
        const header = headers[col];
        if (header) {
          rowData[header] = cell ? cell.v : null;
        }
      }
      rows.push(rowData);
    }

    // Create indexed lookups for fast O(1) search
    const regIndex = new Map(); // registration_number -> row data
    const chassisIndex = new Map(); // chassis_number -> row data
    const combinedIndex = new Map(); // "reg|chassis" -> row data (for exact matches)
    
    rows.forEach((row, index) => {
      const reg = (row.registration_number || row.registrationNumber || '').toString().trim().toUpperCase();
      const chassis = (row.chasis_number || row.chassisNumber || '').toString().trim().toUpperCase();
      
      if (reg) {
        regIndex.set(reg, row);
        if (chassis) {
          combinedIndex.set(`${reg}|${chassis}`, row);
        }
      }
      if (chassis) {
        chassisIndex.set(chassis, row);
      }
    });

    // Cache the parsed data with indexes
    const parseTime = Date.now() - fetchStartTime;
    excelCache.set(gcsFileUrl, {
      data: rows,
      regIndex,
      chassisIndex,
      combinedIndex,
      timestamp: Date.now()
    });

      // Only log in development or for large files
      if (process.env.NODE_ENV === 'development' || rows.length > 10000) {
        console.log(`✅ Cached Excel file: ${gcsFileUrl.split('/').pop()} (${rows.length} rows, ${regIndex.size} reg keys, ${chassisIndex.size} chassis keys) - Total time: ${parseTime}ms`);
      }

    // Return requested row
    // IMPORTANT: rowNumber = row + 1 where row starts from 1 (Excel row 2, first data row)
    // So: Excel row 2 -> rowNumber = 2, and rows[0] = Excel row 2
    // Therefore: rows[rowNumber - 2] gives us the correct row
    const arrayIndex = rowNumber - 2;
    const rowData = arrayIndex >= 0 && arrayIndex < rows.length ? rows[arrayIndex] : null;
    if (!rowData) {
      throw new Error(`Row ${rowNumber} not found in Excel file (arrayIndex: ${arrayIndex}, total rows: ${rows.length})`);
    }
    
    return rowData;
  } catch (error) {
    console.error(`❌ Error getting vehicle data from Excel:`, error);
    throw error;
  }
}

/**
 * Search for vehicles in Excel file by registration/chassis number (Level 2: No rowNumber)
 * @param {string} gcsFileUrl - GCS URL of Excel file
 * @param {Object[]} lookups - Array of lookup objects with registrationNumber and/or chassisNumber
 * @returns {Promise<Object[]>} Array of vehicle data objects matching the lookups
 */
async function searchVehiclesInExcel(gcsFileUrl, lookups) {
  try {
    // Get cached or fetch Excel file
    const cached = excelCache.get(gcsFileUrl);
    let rows, regIndex, chassisIndex, combinedIndex;
    
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      // Cache hit - use cached data and indexes
      rows = cached.data;
      regIndex = cached.regIndex;
      chassisIndex = cached.chassisIndex;
      combinedIndex = cached.combinedIndex;
      // Only log in development
      if (process.env.NODE_ENV === 'development') {
        console.log(`✅ Using cached Excel file: ${gcsFileUrl.split('/').pop()} (${rows.length} rows)`);
      }
    } else {
      // Cache miss - fetch and parse
      const fetchStartTime = Date.now();
      // Only log in development or for first-time fetches
      if (process.env.NODE_ENV === 'development') {
        console.log(`📥 Fetching Excel file from GCS: ${gcsFileUrl.split('/').pop()}`);
      }
      const buffer = await getFileBufferFromGCS(gcsFileUrl);
      const fetchTime = Date.now() - fetchStartTime;
      // Only log slow fetches (>5 seconds) or in development
      if (process.env.NODE_ENV === 'development' || fetchTime > 5000) {
        console.log(`⏱️  GCS fetch time: ${fetchTime}ms`);
      }
      const workbook = XLSX.read(buffer, {
        cellDates: true,
        cellNF: false,
        cellText: false,
        cellStyles: false
      });
      
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
      
      const headers = [];
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
        const cell = worksheet[cellAddress];
        headers[col] = cell ? cell.v : null;
      }

      rows = [];
      regIndex = new Map(); // Map<regNumber, Array<rowData>> - stores ALL matches
      chassisIndex = new Map(); // Map<chassisNumber, Array<rowData>> - stores ALL matches
      combinedIndex = new Map(); // Map<reg|chassis, Array<rowData>> - stores ALL matches
      
      for (let row = 1; row <= range.e.r; row++) {
        const rowData = {};
        for (let col = range.s.c; col <= range.e.c; col++) {
          const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
          const cell = worksheet[cellAddress];
          const header = headers[col];
          if (header) {
            rowData[header] = cell ? cell.v : null;
          }
        }
        rows.push(rowData);
        
        // Build indexes while parsing (O(n) one-time cost)
        // IMPORTANT: Store ALL matches, not just the last one (multiple vehicles can have same reg/chassis)
        const reg = (rowData.registration_number || rowData.registrationNumber || '').toString().trim().toUpperCase();
        const chassis = (rowData.chasis_number || rowData.chassisNumber || '').toString().trim().toUpperCase();
        
        if (reg) {
          // Store array of matches for this registration number
          if (!regIndex.has(reg)) {
            regIndex.set(reg, []);
          }
          regIndex.get(reg).push(rowData);
          
          if (chassis) {
            // Store array of matches for this combined key
            const combinedKey = `${reg}|${chassis}`;
            if (!combinedIndex.has(combinedKey)) {
              combinedIndex.set(combinedKey, []);
            }
            combinedIndex.get(combinedKey).push(rowData);
          }
        }
        if (chassis) {
          // Store array of matches for this chassis number
          if (!chassisIndex.has(chassis)) {
            chassisIndex.set(chassis, []);
          }
          chassisIndex.get(chassis).push(rowData);
        }
      }

      // Cache the parsed data with indexes
      excelCache.set(gcsFileUrl, {
        data: rows,
        regIndex,
        chassisIndex,
        combinedIndex,
        timestamp: Date.now()
      });
      
      // Only log in development or for large files
      if (process.env.NODE_ENV === 'development' || rows.length > 10000) {
        console.log(`✅ Cached Excel file: ${gcsFileUrl.split('/').pop()} (${rows.length} rows, ${regIndex.size} reg keys, ${chassisIndex.size} chassis keys)`);
      }
    }

    // OPTIMIZED: Use indexed lookups for O(1) search instead of O(n) linear search
    // IMPORTANT: Return ALL matches, not just one (multiple vehicles can have same reg/chassis)
    const results = [];
    
    for (const lookup of lookups) {
      const regNum = (lookup.registrationNumber || '').toString().trim().toUpperCase();
      const chassisNum = (lookup.chassisNumber || '').toString().trim().toUpperCase();
      
      if (!regNum && !chassisNum) {
        // No search criteria - skip
        results.push(null);
        continue;
      }
      
      let matches = [];
      
      // OPTIMIZED: Use Map-based lookups (O(1) instead of O(n))
      // IMPORTANT: Indexes now store arrays, so we get ALL matches
      if (regNum && chassisNum) {
        // Both provided - use combined index for exact match
        const combinedKey = `${regNum}|${chassisNum}`;
        matches = combinedIndex.get(combinedKey) || [];
      } else if (regNum) {
        // Only registration - use registration index (returns ALL matches)
        matches = regIndex.get(regNum) || [];
      } else if (chassisNum) {
        // Only chassis - use chassis index (returns ALL matches)
        matches = chassisIndex.get(chassisNum) || [];
      }
      
      // IMPORTANT: Return the FIRST match for this lookup (maintains 1:1 mapping with lookups)
      // BUT: Since indexes now store arrays, ALL vehicles with matching reg/chassis are stored
      // This means if 30 lookups have the same reg number, each will get a match (if vehicles exist)
      // The key fix: Index now stores ALL vehicles, not just the last one
      if (matches.length > 0) {
        // Return first match for this lookup
        // Multiple lookups with same reg will each get their own match (if multiple vehicles exist)
        results.push(matches[0]);
      } else {
        // No match found - only log in debug mode
        if (process.env.NODE_ENV === 'development') {
          console.warn(`⚠️  No exact match found in Excel for: Reg=${regNum}, Chassis=${chassisNum}`);
        }
        results.push(null);
      }
    }
    
    return results;
  } catch (error) {
    console.error(`❌ Error searching vehicles in Excel:`, error);
    throw error;
  }
}

/**
 * Get multiple vehicle rows from Excel file (batch operation) - LEGACY: Uses rowNumber
 * @param {string} gcsFileUrl - GCS URL of Excel file
 * @param {number[]} rowNumbers - Array of row numbers (1-based)
 * @returns {Promise<Object[]>} Array of vehicle data objects
 */
async function getMultipleVehicleDataFromExcel(gcsFileUrl, rowNumbers) {
  try {
    // Check cache first
    const cached = excelCache.get(gcsFileUrl);
    let rows;
    
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      // Cache hit - use cached rows
      rows = cached.data;
    } else {
      // Cache miss - fetch and parse (same as single row)
      const fetchStartTime = Date.now();
      // Only log in development
      if (process.env.NODE_ENV === 'development') {
        console.log(`📥 Fetching Excel file from GCS: ${gcsFileUrl.split('/').pop()}`);
      }
      const buffer = await getFileBufferFromGCS(gcsFileUrl);
      const fetchTime = Date.now() - fetchStartTime;
      // Only log slow fetches (>5 seconds) or in development
      if (process.env.NODE_ENV === 'development' || fetchTime > 5000) {
        console.log(`⏱️  GCS fetch time: ${fetchTime}ms`);
      }
      const workbook = XLSX.read(buffer, {
        cellDates: true,
        cellNF: false,
        cellText: false,
        cellStyles: false
      });
      
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
      
      const headers = [];
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
        const cell = worksheet[cellAddress];
        headers[col] = cell ? cell.v : null;
      }

      rows = [];
      for (let row = 1; row <= range.e.r; row++) {
        const rowData = {};
        for (let col = range.s.c; col <= range.e.c; col++) {
          const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
          const cell = worksheet[cellAddress];
          const header = headers[col];
          if (header) {
            rowData[header] = cell ? cell.v : null;
          }
        }
        rows.push(rowData);
      }

      // Create indexed lookups for fast O(1) search
      const regIndex = new Map();
      const chassisIndex = new Map();
      const combinedIndex = new Map();
      
      rows.forEach((row) => {
        const reg = (row.registration_number || row.registrationNumber || '').toString().trim().toUpperCase();
        const chassis = (row.chasis_number || row.chassisNumber || '').toString().trim().toUpperCase();
        
        if (reg) {
          regIndex.set(reg, row);
          if (chassis) {
            combinedIndex.set(`${reg}|${chassis}`, row);
          }
        }
        if (chassis) {
          chassisIndex.set(chassis, row);
        }
      });

      // Cache the parsed data with indexes
      excelCache.set(gcsFileUrl, {
        data: rows,
        regIndex,
        chassisIndex,
        combinedIndex,
        timestamp: Date.now()
      });
      
      console.log(`✅ Cached Excel file: ${gcsFileUrl} (${rows.length} rows, ${regIndex.size} reg keys, ${chassisIndex.size} chassis keys)`);
    }

    // Return requested rows IN THE SAME ORDER as rowNumbers array
    // This is critical - the order must match the lookup order
    // IMPORTANT: During upload, rowNumber = row + 1 where row starts from 1 (Excel row 2, first data row)
    // So: Excel row 2 -> rowNumber = 2, Excel row 3 -> rowNumber = 3
    // In this function, rows[0] = Excel row 2 (first data), rows[1] = Excel row 3 (second data)
    // Therefore: rows[rowNumber - 2] gives us the correct row
    const result = [];
    for (const rowNum of rowNumbers) {
      const arrayIndex = rowNum - 2; // Convert rowNumber to array index (rowNumber 2 -> index 0)
      const rowData = arrayIndex >= 0 && arrayIndex < rows.length ? rows[arrayIndex] : null;
      if (rowData) {
        result.push(rowData);
      } else {
        console.warn(`⚠️  Row ${rowNum} not found in Excel file (file has ${rows.length} data rows, arrayIndex: ${arrayIndex})`);
        result.push(null); // Push null to maintain order
      }
    }
    
    return result;
  } catch (error) {
    console.error(`❌ Error getting multiple vehicle data from Excel:`, error);
    throw error;
  }
}

/**
 * Clear cache for a specific file
 * @param {string} gcsFileUrl - GCS URL of Excel file
 */
function clearCacheForFile(gcsFileUrl) {
  excelCache.delete(gcsFileUrl);
  console.log(`🗑️ Cleared cache for: ${gcsFileUrl}`);
}

/**
 * Clear all cache
 */
function clearAllCache() {
  excelCache.clear();
  console.log(`🗑️ Cleared all Excel cache`);
}

/**
 * Clean up old cache entries (prevent memory leaks)
 */
function cleanupCache() {
  const cutoffTime = Date.now() - CACHE_TTL;
  let cleaned = 0;
  
  for (const [key, value] of excelCache.entries()) {
    if (value.timestamp < cutoffTime) {
      excelCache.delete(key);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`🧹 Cleaned up ${cleaned} expired cache entries`);
  }
}

// Run cleanup every 10 minutes
setInterval(cleanupCache, 10 * 60 * 1000);

/**
 * Pre-cache Excel files for faster search
 * @param {Array} excelFiles - Array of ExcelFile objects with filePath/gcsFileUrl
 * @returns {Promise<Object>} Cache status with success count and errors
 */
async function preCacheExcelFiles(excelFiles) {
  const results = {
    total: excelFiles.length,
    cached: 0,
    skipped: 0,
    errors: [],
    cachedFiles: []
  };

  console.log(`🚀 Starting pre-cache for ${excelFiles.length} files...`);

  for (const file of excelFiles) {
    try {
      // Get GCS URL from file
      const gcsFileUrl = file.filePath || file.gcsFileUrl;
      
      if (!gcsFileUrl || !gcsFileUrl.includes('storage.googleapis.com')) {
        console.log(`⏭️  Skipping file ${file._id}: Not a GCS file`);
        results.skipped++;
        continue;
      }

      // Check if already cached
      const cached = excelCache.get(gcsFileUrl);
      if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        console.log(`✅ File ${file._id} already cached (${cached.data.length} rows)`);
        results.skipped++;
        results.cachedFiles.push({
          fileId: file._id.toString(),
          fileName: file.originalName || file.filename,
          status: 'already_cached',
          rowCount: cached.data.length
        });
        continue;
      }

      // Fetch and cache the file
      console.log(`📥 Pre-caching file ${file._id}: ${file.originalName || file.filename}`);
      const fetchStartTime = Date.now();
      
      const buffer = await getFileBufferFromGCS(gcsFileUrl);
      const fetchTime = Date.now() - fetchStartTime;
      
      const workbook = XLSX.read(buffer, {
        cellDates: true,
        cellNF: false,
        cellText: false,
        cellStyles: false
      });
      
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
      
      // Get headers
      const headers = [];
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
        const cell = worksheet[cellAddress];
        headers[col] = cell ? cell.v : null;
      }

      // Parse all rows
      const rows = [];
      for (let row = 1; row <= range.e.r; row++) {
        const rowData = {};
        for (let col = range.s.c; col <= range.e.c; col++) {
          const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
          const cell = worksheet[cellAddress];
          const header = headers[col];
          if (header) {
            rowData[header] = cell ? cell.v : null;
          }
        }
        rows.push(rowData);
      }

      // Create indexed lookups for fast O(1) search
      const regIndex = new Map();
      const chassisIndex = new Map();
      const combinedIndex = new Map();
      
      rows.forEach((row) => {
        const reg = (row.registration_number || row.registrationNumber || '').toString().trim().toUpperCase();
        const chassis = (row.chasis_number || row.chassisNumber || '').toString().trim().toUpperCase();
        
        if (reg) {
          regIndex.set(reg, row);
          if (chassis) {
            combinedIndex.set(`${reg}|${chassis}`, row);
          }
        }
        if (chassis) {
          chassisIndex.set(chassis, row);
        }
      });

      // Cache the parsed data with indexes
      excelCache.set(gcsFileUrl, {
        data: rows,
        regIndex,
        chassisIndex,
        combinedIndex,
        timestamp: Date.now()
      });

      const totalTime = Date.now() - fetchStartTime;
      console.log(`✅ Pre-cached file ${file._id}: ${rows.length} rows (${regIndex.size} reg keys, ${chassisIndex.size} chassis keys) (${totalTime}ms)`);
      
      results.cached++;
      results.cachedFiles.push({
        fileId: file._id.toString(),
        fileName: file.originalName || file.filename,
        status: 'cached',
        rowCount: rows.length,
        fetchTime: fetchTime,
        totalTime: totalTime
      });
    } catch (error) {
      console.error(`❌ Error pre-caching file ${file._id}:`, error.message);
      results.errors.push({
        fileId: file._id.toString(),
        fileName: file.originalName || file.filename,
        error: error.message
      });
    }
  }

  console.log(`✅ Pre-cache completed: ${results.cached} cached, ${results.skipped} skipped, ${results.errors.length} errors`);
  return results;
}

/**
 * Get cache details (files, sizes, timestamps)
 * @returns {Object} Cache statistics and file details
 */
function getCacheDetails() {
  const cacheEntries = [];
  let totalRows = 0;
  let totalSize = 0;
  const now = Date.now();
  
  for (const [gcsFileUrl, cacheData] of excelCache.entries()) {
    const age = now - cacheData.timestamp;
    const ageMinutes = Math.floor(age / 60000);
    const ageSeconds = Math.floor((age % 60000) / 1000);
    const expiresIn = CACHE_TTL - age;
    const expiresInMinutes = Math.floor(expiresIn / 60000);
    
    // Estimate size (rough calculation)
    const estimatedSize = JSON.stringify(cacheData.data).length;
    totalSize += estimatedSize;
    totalRows += cacheData.data.length;
    
    cacheEntries.push({
      gcsFileUrl: gcsFileUrl,
      fileName: gcsFileUrl.split('/').pop() || gcsFileUrl,
      rowCount: cacheData.data.length,
      cachedAt: new Date(cacheData.timestamp).toISOString(),
      ageMinutes: ageMinutes,
      ageSeconds: ageSeconds,
      expiresInMinutes: expiresInMinutes,
      isExpired: age >= CACHE_TTL,
      estimatedSize: estimatedSize,
      estimatedSizeMB: (estimatedSize / 1024 / 1024).toFixed(2)
    });
  }
  
  return {
    totalFiles: cacheEntries.length,
    totalRows: totalRows,
    totalSize: totalSize,
    totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
    cacheTTLMinutes: CACHE_TTL / 60000,
    files: cacheEntries.sort((a, b) => b.cachedAt.localeCompare(a.cachedAt))
  };
}

module.exports = {
  getVehicleDataFromExcel,
  getMultipleVehicleDataFromExcel,
  searchVehiclesInExcel, // NEW: Search by registration/chassis number (Level 2)
  clearCacheForFile,
  clearAllCache,
  cleanupCache,
  preCacheExcelFiles,
  getCacheDetails
};
