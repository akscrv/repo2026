const mongoose = require('mongoose');
const FileStorageSettings = require('../models/FileStorageSettings');
const User = require('../models/User');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function initializeFileStorageSettings() {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://amarjeetbrown:wOgbce2ULlBDDazx@repo.npbhh0j.mongodb.net/';
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    let superSuperAdmin = await User.findOne({ role: 'superSuperAdmin', isActive: true });
    if (!superSuperAdmin) {
      console.log('❌ No active superSuperAdmin found!');
      console.log('💡 Please run "node script/create-admins.js" first to create admin users.');
      process.exit(1);
    }
    console.log(`✅ Using existing superSuperAdmin: ${superSuperAdmin.email}`);

    const defaultSettings = [
      { role: 'admin', totalRecordLimit: 500000, description: 'Total individual limit for admin users - 5 lakh records maximum', updatedBy: superSuperAdmin._id },
      { role: 'superAdmin', totalRecordLimit: 1000000, description: 'Total individual limit for super admin users - 10 lakh records maximum', updatedBy: superSuperAdmin._id },
      { role: 'superSuperAdmin', totalRecordLimit: 10000000, description: 'Total individual limit for super super admin users - 1 crore records maximum', updatedBy: superSuperAdmin._id }
    ];

    await FileStorageSettings.deleteMany({});
    console.log('Cleared existing file storage settings');
    const settings = await FileStorageSettings.insertMany(defaultSettings);
    console.log('Initialized file storage settings:');
    settings.forEach(setting => {
      console.log(`- ${setting.role}: ${setting.totalRecordLimit.toLocaleString()} total records`);
    });
    console.log('File storage settings initialization completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error initializing file storage settings:', error);
    process.exit(1);
  }
}

initializeFileStorageSettings();

