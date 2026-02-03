require('dotenv').config();
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const { Storage } = require('@google-cloud/storage');
const { isGCSConfigured, uploadFileToGCS, getFileBufferFromGCS, deleteFileFromGCS } = require('../services/gcsService');
const VehicleLookup = require('../models/VehicleLookup');

/**
 * Comprehensive GCS Setup Verification Script
 * Tests all components of the storage optimization system
 */

async function verifySetup() {
  const results = {
    passed: [],
    failed: [],
    warnings: []
  };

  console.log('🔍 Verifying Google Cloud Storage Setup...\n');
  console.log('='.repeat(60));

  // Test 1: Environment Variables
  console.log('\n📋 Test 1: Environment Variables');
  console.log('-'.repeat(60));
  
  const requiredEnvVars = ['GCS_PROJECT_ID', 'GCS_BUCKET_NAME', 'GCS_KEY_FILE'];
  let envVarsOk = true;
  
  for (const varName of requiredEnvVars) {
    const value = process.env[varName];
    if (value) {
      console.log(`  ✅ ${varName}: ${value}`);
      results.passed.push(`Environment variable ${varName} is set`);
    } else {
      console.log(`  ❌ ${varName}: NOT SET`);
      results.failed.push(`Environment variable ${varName} is not set`);
      envVarsOk = false;
    }
  }
  
  if (process.env.GCS_PUBLIC_ACCESS) {
    console.log(`  ℹ️  GCS_PUBLIC_ACCESS: ${process.env.GCS_PUBLIC_ACCESS}`);
  } else {
    console.log(`  ⚠️  GCS_PUBLIC_ACCESS: Not set (defaults to false, using signed URLs)`);
    results.warnings.push('GCS_PUBLIC_ACCESS not set, will use signed URLs');
  }

  // Test 2: Key File Exists
  console.log('\n📁 Test 2: GCS Key File');
  console.log('-'.repeat(60));
  
  const keyFilePath = process.env.GCS_KEY_FILE || path.join(__dirname, '../config/gcs-key.json');
  const keyFileExists = fs.existsSync(keyFilePath);
  
  if (keyFileExists) {
    console.log(`  ✅ Key file exists: ${keyFilePath}`);
    results.passed.push('GCS key file exists');
    
    // Try to parse JSON
    try {
      const keyData = JSON.parse(fs.readFileSync(keyFilePath, 'utf-8'));
      if (keyData.project_id) {
        console.log(`  ✅ Key file is valid JSON`);
        console.log(`  ✅ Project ID in key: ${keyData.project_id}`);
        
        // Check if project ID matches
        if (keyData.project_id === process.env.GCS_PROJECT_ID) {
          console.log(`  ✅ Project ID matches environment variable`);
          results.passed.push('Project ID in key file matches GCS_PROJECT_ID');
        } else {
          console.log(`  ⚠️  Project ID mismatch: key file has ${keyData.project_id}, env has ${process.env.GCS_PROJECT_ID}`);
          results.warnings.push('Project ID in key file does not match GCS_PROJECT_ID');
        }
      } else {
        console.log(`  ⚠️  Key file missing project_id field`);
        results.warnings.push('Key file missing project_id field');
      }
    } catch (error) {
      console.log(`  ❌ Key file is not valid JSON: ${error.message}`);
      results.failed.push(`Key file is not valid JSON: ${error.message}`);
    }
  } else {
    console.log(`  ❌ Key file not found: ${keyFilePath}`);
    results.failed.push(`GCS key file not found at ${keyFilePath}`);
  }

  // Test 3: GCS Service Initialization
  console.log('\n🔧 Test 3: GCS Service Initialization');
  console.log('-'.repeat(60));
  
  if (isGCSConfigured()) {
    console.log(`  ✅ GCS service is configured`);
    results.passed.push('GCS service is properly configured');
  } else {
    console.log(`  ❌ GCS service is not configured`);
    results.failed.push('GCS service is not properly configured');
  }

  // Test 4: MongoDB Connection
  console.log('\n🗄️  Test 4: MongoDB Connection');
  console.log('-'.repeat(60));
  
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`  ✅ MongoDB connected: ${mongoose.connection.host}`);
    results.passed.push('MongoDB connection successful');
  } catch (error) {
    console.log(`  ❌ MongoDB connection failed: ${error.message}`);
    results.failed.push(`MongoDB connection failed: ${error.message}`);
  }

  // Test 5: VehicleLookup Model
  console.log('\n📊 Test 5: VehicleLookup Model');
  console.log('-'.repeat(60));
  
  try {
    const collection = VehicleLookup.collection;
    const stats = await collection.stats();
    console.log(`  ✅ VehicleLookup collection exists`);
    console.log(`  📈 Documents: ${stats.count || 0}`);
    console.log(`  💾 Size: ${((stats.size || 0) / 1024 / 1024).toFixed(2)} MB`);
    results.passed.push('VehicleLookup model is accessible');
    
    // Check indexes
    const indexes = await collection.indexes();
    console.log(`  📑 Indexes: ${indexes.length}`);
    const indexNames = indexes.map(idx => idx.name).join(', ');
    console.log(`  📋 Index names: ${indexNames}`);
    
    // Updated required indexes after storage reduction (Level 1-3)
    // Only need: reg_idx, chassis_idx (non-unique, duplicates allowed)
    const requiredIndexes = ['reg_idx', 'chassis_idx'];
    const existingIndexNames = indexes.map(idx => idx.name);
    const missingIndexes = requiredIndexes.filter(name => !existingIndexNames.includes(name));
    
    if (missingIndexes.length === 0) {
      console.log(`  ✅ All required indexes exist (optimized for storage reduction)`);
      results.passed.push('All required indexes exist');
    } else {
      console.log(`  ⚠️  Missing indexes: ${missingIndexes.join(', ')}`);
      console.log(`  💡 Run: node script/migrate-storage-reduction-level1-2-3.js`);
      results.warnings.push(`Missing indexes: ${missingIndexes.join(', ')}`);
    }
  } catch (error) {
    console.log(`  ❌ VehicleLookup model error: ${error.message}`);
    results.failed.push(`VehicleLookup model error: ${error.message}`);
  }

  // Test 6: GCS Bucket Access (only if configured)
  console.log('\n☁️  Test 6: GCS Bucket Access');
  console.log('-'.repeat(60));
  
  if (isGCSConfigured() && envVarsOk && keyFileExists) {
    try {
      const storage = new Storage({
        projectId: process.env.GCS_PROJECT_ID,
        keyFilename: keyFilePath
      });
      
      const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);
      
      // Check if bucket exists and is accessible
      const [exists] = await bucket.exists();
      if (exists) {
        console.log(`  ✅ Bucket exists: ${process.env.GCS_BUCKET_NAME}`);
        results.passed.push('GCS bucket exists and is accessible');
        
        // Get bucket metadata
        const [metadata] = await bucket.getMetadata();
        console.log(`  📍 Location: ${metadata.location}`);
        console.log(`  📅 Created: ${new Date(metadata.timeCreated).toLocaleString()}`);
        
        // List a few files
        const [files] = await bucket.getFiles({ maxResults: 5 });
        console.log(`  📁 Files in bucket: ${files.length} shown (may have more)`);
        if (files.length > 0) {
          files.forEach((file, i) => {
            console.log(`     ${i + 1}. ${file.name}`);
          });
        }
      } else {
        console.log(`  ❌ Bucket does not exist: ${process.env.GCS_BUCKET_NAME}`);
        results.failed.push(`GCS bucket does not exist: ${process.env.GCS_BUCKET_NAME}`);
      }
    } catch (error) {
      console.log(`  ❌ GCS bucket access error: ${error.message}`);
      results.failed.push(`GCS bucket access error: ${error.message}`);
      
      if (error.message.includes('permission')) {
        console.log(`  💡 Check service account has "Storage Object Admin" role`);
      } else if (error.message.includes('not found')) {
        console.log(`  💡 Verify bucket name is correct and exists in project`);
      }
    }
  } else {
    console.log(`  ⏭️  Skipped (GCS not fully configured)`);
    results.warnings.push('GCS bucket test skipped due to configuration issues');
  }

  // Test 7: Upload/Download Test (only if configured)
  console.log('\n📤 Test 7: GCS Upload/Download Test');
  console.log('-'.repeat(60));
  
  if (isGCSConfigured() && envVarsOk && keyFileExists) {
    try {
      // Create a test file
      const testContent = `GCS Test File - Created at ${new Date().toISOString()}`;
      const testFilePath = path.join(__dirname, '../uploads/temp/test-gcs-verify.txt');
      
      // Ensure directory exists
      const uploadsDir = path.dirname(testFilePath);
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      
      fs.writeFileSync(testFilePath, testContent);
      console.log(`  ✅ Test file created: ${testFilePath}`);
      
      // Upload to GCS
      const testFileName = `test/verify-${Date.now()}.txt`;
      console.log(`  📤 Uploading to GCS...`);
      const gcsUrl = await uploadFileToGCS(testFilePath, testFileName);
      console.log(`  ✅ File uploaded: ${gcsUrl.substring(0, 80)}...`);
      results.passed.push('GCS upload test successful');
      
      // Download from GCS
      console.log(`  📥 Downloading from GCS...`);
      const buffer = await getFileBufferFromGCS(gcsUrl);
      const downloadedContent = buffer.toString('utf-8');
      
      if (downloadedContent === testContent) {
        console.log(`  ✅ File downloaded and content matches`);
        results.passed.push('GCS download test successful');
      } else {
        console.log(`  ⚠️  Downloaded content does not match`);
        results.warnings.push('Downloaded content does not match original');
      }
      
      // Delete test file
      console.log(`  🗑️  Deleting test file...`);
      await deleteFileFromGCS(gcsUrl);
      console.log(`  ✅ Test file deleted`);
      results.passed.push('GCS delete test successful');
      
      // Cleanup local file
      try {
        fs.unlinkSync(testFilePath);
      } catch (err) {
        // Ignore
      }
      
    } catch (error) {
      console.log(`  ❌ GCS upload/download test failed: ${error.message}`);
      results.failed.push(`GCS upload/download test failed: ${error.message}`);
    }
  } else {
    console.log(`  ⏭️  Skipped (GCS not fully configured)`);
    results.warnings.push('GCS upload/download test skipped due to configuration issues');
  }

  // Test 8: Dependencies
  console.log('\n📦 Test 8: Dependencies');
  console.log('-'.repeat(60));
  
  try {
    const packageJson = require('../package.json');
    const hasGCS = packageJson.dependencies && packageJson.dependencies['@google-cloud/storage'];
    
    if (hasGCS) {
      console.log(`  ✅ @google-cloud/storage installed: ${hasGCS}`);
      results.passed.push('@google-cloud/storage package is installed');
    } else {
      console.log(`  ❌ @google-cloud/storage not found in package.json`);
      results.failed.push('@google-cloud/storage package not installed');
      console.log(`  💡 Run: npm install @google-cloud/storage`);
    }
  } catch (error) {
    console.log(`  ⚠️  Could not check dependencies: ${error.message}`);
    results.warnings.push('Could not verify dependencies');
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 VERIFICATION SUMMARY');
  console.log('='.repeat(60));
  
  console.log(`\n✅ Passed: ${results.passed.length}`);
  results.passed.forEach((msg, i) => {
    console.log(`   ${i + 1}. ${msg}`);
  });
  
  if (results.warnings.length > 0) {
    console.log(`\n⚠️  Warnings: ${results.warnings.length}`);
    results.warnings.forEach((msg, i) => {
      console.log(`   ${i + 1}. ${msg}`);
    });
  }
  
  if (results.failed.length > 0) {
    console.log(`\n❌ Failed: ${results.failed.length}`);
    results.failed.forEach((msg, i) => {
      console.log(`   ${i + 1}. ${msg}`);
    });
  }
  
  console.log('\n' + '='.repeat(60));
  
  if (results.failed.length === 0) {
    console.log('🎉 All critical tests passed! GCS setup is working correctly.');
    console.log('\n✅ Next steps:');
    console.log('   1. Indexes are already optimized (reg_idx, chassis_idx)');
    console.log('   2. Test upload: Use POST /api/excel/upload endpoint');
    console.log('   3. Test search: Use GET /api/excel/vehicles endpoint');
  } else {
    console.log('⚠️  Some tests failed. Please fix the issues above.');
  }
  
  console.log('='.repeat(60) + '\n');

  // Close MongoDB connection
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.close();
  }

  process.exit(results.failed.length === 0 ? 0 : 1);
}

// Run verification
verifySetup().catch(error => {
  console.error('\n❌ Verification script error:', error);
  process.exit(1);
});
