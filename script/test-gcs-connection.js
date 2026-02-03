const { uploadFileToGCS, getFileBufferFromGCS, deleteFileFromGCS, isGCSConfigured } = require('../services/gcsService');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

/**
 * Test Google Cloud Storage Connection
 * This script verifies that GCS is properly configured
 */
async function testGCSConnection() {
  try {
    console.log('🧪 Testing Google Cloud Storage Connection...\n');

    // Check environment variables
    console.log('📋 Configuration:');
    console.log(`  GCS_PROJECT_ID: ${process.env.GCS_PROJECT_ID || 'NOT SET'}`);
    console.log(`  GCS_BUCKET_NAME: ${process.env.GCS_BUCKET_NAME || 'NOT SET'}`);
    console.log(`  GCS_KEY_FILE: ${process.env.GCS_KEY_FILE || 'NOT SET'}`);
    console.log(`  GCS_KEY_JSON: ${process.env.GCS_KEY_JSON ? 'SET (base64)' : 'NOT SET'}`);
    console.log('');

    if (!process.env.GCS_BUCKET_NAME) {
      throw new Error('GCS_BUCKET_NAME environment variable is not set');
    }

    // Test 1: Create a test file
    console.log('📤 Test 1: Uploading test file...');
    const testContent = `Test file created at ${new Date().toISOString()}`;
    const testFilePath = path.join(__dirname, '../uploads/temp/test-gcs-connection.txt');
    
    // Ensure temp directory exists
    const fs = require('fs').promises;
    await fs.mkdir(path.dirname(testFilePath), { recursive: true });
    await fs.writeFile(testFilePath, testContent);

    const testFileName = `test-connection-${Date.now()}.txt`;
    // Use correct function name: uploadFileToGCS
    const gcsUrl = await uploadFileToGCS(testFilePath, `test/${testFileName}`);
    console.log(`  ✅ File uploaded: ${gcsUrl.substring(0, 80)}...`);

    // Test 2: Download the file
    console.log('\n📥 Test 2: Downloading test file...');
    const downloadPath = path.join(__dirname, '../uploads/temp/test-downloaded.txt');
    const buffer = await getFileBufferFromGCS(gcsUrl);
    await fs.writeFile(downloadPath, buffer);
    const downloadedContent = await fs.readFile(downloadPath, 'utf-8');
    console.log(`  ✅ File downloaded: ${downloadedContent.substring(0, 50)}...`);

    // Test 3: Verify content matches
    console.log('\n🔍 Test 3: Verifying content...');
    if (downloadedContent === testContent) {
      console.log(`  ✅ Content matches perfectly`);
    } else {
      throw new Error('Downloaded content does not match original');
    }

    // Test 4: Delete test file
    console.log('\n🗑️  Test 4: Cleaning up test file...');
    await deleteFileFromGCS(gcsUrl);
    console.log('  ✅ Test file deleted');

    // Cleanup local files
    try {
      await fs.unlink(testFilePath);
      await fs.unlink(downloadPath);
    } catch (err) {
      // Ignore cleanup errors
    }

    console.log('\n✅ All GCS tests passed!');
    console.log('🎉 Google Cloud Storage is properly configured.');
    console.log('\n💡 Note: The GCS URL includes a signed URL that expires after some time.');
    console.log('   For production, files are accessed via signed URLs generated on-demand.');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ GCS Connection Test Failed!');
    console.error('Error:', error.message);
    console.error('\n💡 Troubleshooting:');
    console.error('1. Check that GCS_BUCKET_NAME is set in .env');
    console.error('2. Verify GCS_KEY_FILE path is correct');
    console.error('3. Ensure service account has Storage Object Admin role');
    console.error('4. Check that Cloud Storage API is enabled');
    console.error('5. Verify bucket exists in the specified project');
    process.exit(1);
  }
}

testGCSConnection();
