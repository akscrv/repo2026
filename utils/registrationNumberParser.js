/**
 * Indian Vehicle Registration Number Parser
 * Format: [State Code (2 letters)][2 digits][2 letters][4 digits]
 * Examples: WB24OP1614, HR26CD5678, DL01AB1234, UP32EF9012
 * Special: BH (Bharat number) - BH12AB1234
 */

/**
 * Extract state code and last 4 digits from registration number
 * @param {string} registrationNumber - Full registration number
 * @returns {Object|null} { stateCode: string, lastFourDigits: string, isBharat: boolean }
 */
function parseRegistrationNumber(registrationNumber) {
  if (!registrationNumber || typeof registrationNumber !== 'string') {
    return null;
  }

  const cleaned = registrationNumber.trim().toUpperCase().replace(/\s+/g, '');
  
  // Check for BH (Bharat number) - BH12AB1234 format
  if (cleaned.startsWith('BH') && cleaned.length >= 10) {
    const lastFour = cleaned.slice(-4);
    if (/^\d{4}$/.test(lastFour)) {
      return {
        stateCode: 'BH',
        lastFourDigits: lastFour,
        isBharat: true,
        fullNumber: cleaned
      };
    }
  }

  // Standard format: [State Code (2 letters)][2 digits][2 letters][4 digits]
  // Minimum length: 10 characters (e.g., WB24OP1614)
  // Pattern: 2 letters + 2 digits + 2 letters + 4 digits = 10 characters minimum
  if (cleaned.length >= 10) {
    // Extract state code (first 2 letters)
    const stateCode = cleaned.substring(0, 2);
    // Extract last 4 digits (last 4 characters)
    const lastFour = cleaned.slice(-4);
    
    // Validate: state code must be 2 uppercase letters, last 4 must be 4 digits
    // Also check that the format matches: [2 letters][2 digits][2 letters][4 digits]
    const formatMatch = /^[A-Z]{2}\d{2}[A-Z]{2}\d{4}$/.test(cleaned);
    
    if (/^[A-Z]{2}$/.test(stateCode) && /^\d{4}$/.test(lastFour) && formatMatch) {
      return {
        stateCode: stateCode,
        lastFourDigits: lastFour,
        isBharat: false,
        fullNumber: cleaned
      };
    }
  }

  return null;
}

/**
 * Extract state code from registration number
 * @param {string} registrationNumber - Full registration number
 * @returns {string|null} State code (2 letters) or null
 */
function getStateCode(registrationNumber) {
  const parsed = parseRegistrationNumber(registrationNumber);
  return parsed ? parsed.stateCode : null;
}

/**
 * Extract last 4 digits from registration number
 * @param {string} registrationNumber - Full registration number
 * @returns {string|null} Last 4 digits or null
 */
function getLastFourDigits(registrationNumber) {
  const parsed = parseRegistrationNumber(registrationNumber);
  return parsed ? parsed.lastFourDigits : null;
}

/**
 * Build search query for state code + last 4 digits using RUNTIME PARSING (Level 3)
 * No stored fields - parses registrationNumber at query time using regex
 * @param {string} stateCode - State code (2 letters) or 'ALL' for all states
 * @param {string} lastFourDigits - Last 4 digits (can be partial like '16' or full '1614')
 * @returns {Object} MongoDB query object using regex on registrationNumber field
 */
function buildStateCodeSearchQuery(stateCode, lastFourDigits) {
  if (!lastFourDigits || lastFourDigits.length === 0) {
    return null;
  }

  // Clean and validate lastFourDigits (only numbers, max 4 digits)
  const cleanDigits = lastFourDigits.toString().replace(/\D/g, '').slice(0, 4);
  if (cleanDigits.length === 0) {
    return null;
  }

  // LEVEL 3: Runtime parsing - build regex on registrationNumber field
  // Format: [State Code (2 letters)][2 digits][2 letters][4 digits]
  // Example: DL01AB1237 -> State: DL, Last4: 1237
  
  let regexPattern;
  
  if (stateCode && stateCode !== 'ALL' && stateCode !== '') {
    // Search specific state code: ^DL.*1237$ or ^DL.*123$ (for partial)
    if (cleanDigits.length === 4) {
      // Exact 4 digits match
      regexPattern = `^${stateCode}.*${cleanDigits}$`;
    } else {
      // Partial digits (1-3) - match prefix
      regexPattern = `^${stateCode}.*${cleanDigits}`;
    }
    
    // Also include BH (Bharat) numbers if searching for any state (except when searching BH specifically)
    if (stateCode !== 'BH') {
      let bhPattern;
      if (cleanDigits.length === 4) {
        bhPattern = `^BH.*${cleanDigits}$`;
      } else {
        bhPattern = `^BH.*${cleanDigits}`;
      }
      
      return {
        $or: [
          { registrationNumber: { $regex: regexPattern, $options: 'i' } },
          { registrationNumber: { $regex: bhPattern, $options: 'i' } }
        ]
      };
    }
    
    return {
      registrationNumber: { $regex: regexPattern, $options: 'i' }
    };
  } else {
    // Search all states - match last 4 digits anywhere in registration number
    if (cleanDigits.length === 4) {
      // Exact 4 digits at the end
      regexPattern = `${cleanDigits}$`;
    } else {
      // Partial digits - match anywhere (slower but works)
      regexPattern = cleanDigits;
    }
    
    return {
      registrationNumber: { $regex: regexPattern, $options: 'i' }
    };
  }
}

/**
 * Indian state codes list
 */
const INDIAN_STATE_CODES = [
  'AP', 'AR', 'AS', 'BR', 'CG', 'DL', 'GA', 'GJ', 'HR', 'HP',
  'JK', 'JH', 'KA', 'KL', 'LD', 'MP', 'MH', 'MN', 'ML', 'MZ',
  'NL', 'OR', 'PB', 'PY', 'RJ', 'SK', 'TN', 'TS', 'TR', 'UP',
  'UK', 'WB', 'AN', 'CH', 'DN', 'DD', 'LA', 'BH'
];

module.exports = {
  parseRegistrationNumber,
  getStateCode,
  getLastFourDigits,
  buildStateCodeSearchQuery,
  INDIAN_STATE_CODES
};
