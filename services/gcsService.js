const { Storage } = require('@google-cloud/storage');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;

/**
 * Google Cloud Storage Service
 * Handles all GCS operations for Excel file storage
 */

// Initialize GCS client
let storage;
let bucket;

try {
  // Check if GCS credentials are provided via environment variable or key file
  const keyFilename = process.env.GCS_KEY_FILE || path.join(__dirname, '../config/gcs-key.json');
  const keyFileExists = fs.existsSync(keyFilename);
  
  // Initialize storage client
  const storageConfig = {
    projectId: process.env.GCS_PROJECT_ID
  };
  
  // Use key file if it exists, otherwise rely on GOOGLE_APPLICATION_CREDENTIALS env var
  if (keyFileExists) {
    storageConfig.keyFilename = keyFilename;
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // Use environment variable if key file doesn't exist
    storageConfig.keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
  
  storage = new Storage(storageConfig);
  
  if (process.env.GCS_BUCKET_NAME) {
    bucket = storage.bucket(process.env.GCS_BUCKET_NAME);
    console.log('✅ Google Cloud Storage initialized');
    console.log(`📦 Bucket: ${process.env.GCS_BUCKET_NAME}`);
  } else {
    console.warn('⚠️  GCS_BUCKET_NAME not set. GCS operations will fail.');
  }
} catch (error) {
  console.error('❌ GCS initialization error:', error.message);
  console.warn('⚠️  GCS operations will fail until credentials are configured');
}

/**
 * Upload Excel file to GCS
 * @param {string} localFilePath - Path to local file
 * @param {string} destinationFileName - Name for file in GCS
 * @returns {Promise<string>} Public URL of uploaded file
 */
async function uploadFileToGCS(localFilePath, destinationFileName) {
  try {
    if (!bucket) {
      throw new Error('GCS bucket not initialized. Check GCS configuration.');
    }

    // Create GCS file reference
    const file = bucket.file(destinationFileName);
    
    // Upload file
    await bucket.upload(localFilePath, {
      destination: destinationFileName,
      metadata: {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        cacheControl: 'public, max-age=31536000', // Cache for 1 year
      },
    });

    // Make file publicly accessible (or use signed URLs for private access)
    if (process.env.GCS_PUBLIC_ACCESS === 'true') {
      await file.makePublic();
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${destinationFileName}`;
      console.log(`✅ File uploaded to GCS: ${publicUrl}`);
      return publicUrl;
    } else {
      // Generate signed URL (valid for 1 year)
      const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year
      });
      console.log(`✅ File uploaded to GCS with signed URL`);
      return signedUrl;
    }
  } catch (error) {
    console.error('❌ GCS upload error:', error);
    throw new Error(`Failed to upload file to GCS: ${error.message}`);
  }
}

/**
 * Download file from GCS to local temporary location
 * @param {string} gcsFileUrl - GCS URL or file path
 * @returns {Promise<string>} Local file path
 */
async function downloadFileFromGCS(gcsFileUrl, localFilePath) {
  try {
    if (!bucket) {
      throw new Error('GCS bucket not initialized. Check GCS configuration.');
    }

    // Extract file name from URL (handle signed URLs with query parameters)
    let fileName;
    if (gcsFileUrl.includes('storage.googleapis.com')) {
      // Handle both public URLs and signed URLs
      const urlParts = gcsFileUrl.split('?')[0]; // Remove query parameters
      const pathParts = urlParts.split('/');
      // Get everything after bucket name
      const bucketIndex = pathParts.findIndex(part => part === bucket.name);
      if (bucketIndex >= 0 && bucketIndex < pathParts.length - 1) {
        fileName = pathParts.slice(bucketIndex + 1).join('/');
      } else {
        // Fallback: get last part
        fileName = pathParts[pathParts.length - 1];
      }
    } else if (gcsFileUrl.includes('/')) {
      // Path format: bucket-name/file-name or just file-name
      fileName = gcsFileUrl.split('/').slice(-1)[0];
    } else {
      fileName = gcsFileUrl;
    }

    // Remove any query parameters if still present
    fileName = fileName.split('?')[0];

    const file = bucket.file(fileName);
    
    // Download to local file
    await file.download({ destination: localFilePath });
    
    console.log(`✅ File downloaded from GCS: ${fileName} -> ${localFilePath}`);
    return localFilePath;
  } catch (error) {
    console.error('❌ GCS download error:', error);
    throw new Error(`Failed to download file from GCS: ${error.message}`);
  }
}

/**
 * Get file buffer from GCS (for in-memory processing)
 * @param {string} gcsFileUrl - GCS URL or file path
 * @returns {Promise<Buffer>} File buffer
 */
async function getFileBufferFromGCS(gcsFileUrl) {
  try {
    if (!bucket) {
      throw new Error('GCS bucket not initialized. Check GCS configuration.');
    }

    // Extract file name from URL (handle signed URLs with query parameters)
    let fileName;
    if (gcsFileUrl.includes('storage.googleapis.com')) {
      // Handle both public URLs and signed URLs
      // Public: https://storage.googleapis.com/bucket-name/file-name
      // Signed: https://storage.googleapis.com/bucket-name/file-name?GoogleAccessId=...
      const urlParts = gcsFileUrl.split('?')[0]; // Remove query parameters
      const pathParts = urlParts.split('/');
      // Get everything after bucket name
      const bucketIndex = pathParts.findIndex(part => part === bucket.name);
      if (bucketIndex >= 0 && bucketIndex < pathParts.length - 1) {
        fileName = pathParts.slice(bucketIndex + 1).join('/');
      } else {
        // Fallback: get last part
        fileName = pathParts[pathParts.length - 1];
      }
    } else if (gcsFileUrl.includes('/')) {
      // Path format: bucket-name/file-name or just file-name
      fileName = gcsFileUrl.split('/').slice(-1)[0];
    } else {
      fileName = gcsFileUrl;
    }

    // Remove any query parameters if still present
    fileName = fileName.split('?')[0];

    const file = bucket.file(fileName);
    // OPTIMIZED: Use faster download options
    const [buffer] = await file.download({
      validation: false, // Skip MD5 validation for faster download
    });
    
    // Only log in development or for large files
    if (process.env.NODE_ENV === 'development' || buffer.length > 10 * 1024 * 1024) {
      console.log(`✅ File buffer retrieved from GCS: ${fileName} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
    }
    return buffer;
  } catch (error) {
    console.error('❌ GCS get buffer error:', error);
    throw new Error(`Failed to get file buffer from GCS: ${error.message}`);
  }
}

/**
 * Delete file from GCS
 * @param {string} gcsFileUrl - GCS URL or file path
 * @returns {Promise<void>}
 */
async function deleteFileFromGCS(gcsFileUrl) {
  try {
    if (!bucket) {
      throw new Error('GCS bucket not initialized. Check GCS configuration.');
    }

    // Extract file name from URL (handle signed URLs with query parameters)
    let fileName;
    if (gcsFileUrl.includes('storage.googleapis.com')) {
      // Handle both public URLs and signed URLs
      const urlParts = gcsFileUrl.split('?')[0]; // Remove query parameters
      const pathParts = urlParts.split('/');
      // Get everything after bucket name
      const bucketIndex = pathParts.findIndex(part => part === bucket.name);
      if (bucketIndex >= 0 && bucketIndex < pathParts.length - 1) {
        fileName = pathParts.slice(bucketIndex + 1).join('/');
      } else {
        // Fallback: get last part
        fileName = pathParts[pathParts.length - 1];
      }
    } else if (gcsFileUrl.includes('/')) {
      // Path format: bucket-name/file-name or just file-name
      fileName = gcsFileUrl.split('/').slice(-1)[0];
    } else {
      fileName = gcsFileUrl;
    }

    // Remove any query parameters if still present
    fileName = fileName.split('?')[0];

    const file = bucket.file(fileName);
    await file.delete();
    
    console.log(`✅ File deleted from GCS: ${fileName}`);
  } catch (error) {
    console.error('❌ GCS delete error:', error);
    throw new Error(`Failed to delete file from GCS: ${error.message}`);
  }
}

/**
 * Check if GCS is properly configured
 * @returns {boolean}
 */
function isGCSConfigured() {
  return !!bucket && !!process.env.GCS_BUCKET_NAME;
}

module.exports = {
  uploadFileToGCS,
  downloadFileFromGCS,
  getFileBufferFromGCS,
  deleteFileFromGCS,
  isGCSConfigured
};
