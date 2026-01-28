const mongoose = require('mongoose');
const FileStorageSettings = require('../models/FileStorageSettings');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function updateStorageDescriptions() {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://amarjeetbrown:wOgbce2ULlBDDazx@repo.npbhh0j.mongodb.net/';
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    // Update descriptions to replace "cumulative" with "individual"
    const updates = [
      {
        role: 'admin',
        description: 'Total individual limit for admin users - 5 lakh records maximum'
      },
      {
        role: 'superAdmin',
        description: 'Total individual limit for super admin users - 10 lakh records maximum'
      },
      {
        role: 'superSuperAdmin',
        description: 'Total individual limit for super super admin users - 1 crore records maximum'
      }
    ];

    for (const update of updates) {
      const result = await FileStorageSettings.updateOne(
        { role: update.role },
        { $set: { description: update.description } }
      );
      console.log(`Updated ${update.role}: ${result.modifiedCount} document(s) modified`);
    }

    console.log('✅ All storage descriptions updated successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error updating storage descriptions:', error);
    process.exit(1);
  }
}

updateStorageDescriptions();
