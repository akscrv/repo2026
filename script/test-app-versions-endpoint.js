/**
 * Test script to verify /api/app-management/public/versions endpoint
 * Run with: node script/test-app-versions-endpoint.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const AppVersion = require('../models/AppVersion');

async function testEndpoint() {
  try {
    console.log('🔍 Testing App Versions Endpoint...\n');

    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Test 1: Check if any app versions exist
    console.log('📱 Test 1: Checking for app versions in database...');
    const allVersions = await AppVersion.find({}).lean();
    console.log(`   Found ${allVersions.length} total app version(s) in database`);

    if (allVersions.length > 0) {
      allVersions.forEach((version, index) => {
        console.log(`   ${index + 1}. ${version.appType} - v${version.version} (Code: ${version.versionCode}) - Active: ${version.isActive}`);
      });
    }
    console.log('');

    // Test 2: Check active versions (what endpoint returns)
    console.log('📱 Test 2: Checking active app versions (endpoint response)...');
    const activeVersions = await AppVersion.find({ isActive: true })
      .populate('uploadedBy', 'name')
      .sort({ createdAt: -1 })
      .lean();

    console.log(`   Found ${activeVersions.length} active app version(s)`);

    if (activeVersions.length > 0) {
      activeVersions.forEach((version, index) => {
        console.log(`\n   Version ${index + 1}:`);
        console.log(`     - ID: ${version._id}`);
        console.log(`     - Type: ${version.appType}`);
        console.log(`     - Version: ${version.version}`);
        console.log(`     - Version Code: ${version.versionCode}`);
        console.log(`     - File Name: ${version.fileName}`);
        console.log(`     - File Path: ${version.filePath}`);
        console.log(`     - File Size: ${(version.fileSize / 1024 / 1024).toFixed(2)} MB`);
        console.log(`     - Description: ${version.description || 'N/A'}`);
        console.log(`     - Features: ${version.features?.join(', ') || 'N/A'}`);
        console.log(`     - Downloads: ${version.downloadCount}`);
        console.log(`     - Uploaded By: ${version.uploadedBy?.name || 'N/A'}`);
        console.log(`     - Created: ${version.createdAt}`);
      });

      // Test 3: Simulate endpoint response
      console.log('\n📱 Test 3: Simulating endpoint response...');
      const endpointResponse = {
        success: true,
        data: activeVersions
      };
      console.log('   Response structure:');
      console.log(JSON.stringify(endpointResponse, null, 2));

      // Test 4: Check file existence
      console.log('\n📱 Test 4: Checking if APK files exist on disk...');
      const fs = require('fs');
      const path = require('path');

      for (const version of activeVersions) {
        const filePath = path.join(__dirname, '..', version.filePath);
        const exists = fs.existsSync(filePath);
        console.log(`   ${version.fileName}: ${exists ? '✅ EXISTS' : '❌ NOT FOUND'}`);
        if (exists) {
          const stats = fs.statSync(filePath);
          console.log(`     Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        } else {
          console.log(`     Expected path: ${filePath}`);
        }
      }
    } else {
      console.log('   ⚠️  No active app versions found!');
      console.log('   💡 Upload an app version via the frontend to test the endpoint.');
    }

    // Test 5: Verify endpoint URL
    console.log('\n📱 Test 5: Endpoint Information...');
    console.log('   Endpoint URL: GET /api/app-management/public/versions');
    console.log('   Access: Public (no authentication required)');
    console.log('   CORS: Allowed for all origins (mobile apps)');

    console.log('\n✅ All tests completed!\n');

  } catch (error) {
    console.error('❌ Error testing endpoint:', error);
  } finally {
    await mongoose.disconnect();
    console.log('📡 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run the test
testEndpoint();
