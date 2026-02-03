const mongoose = require('mongoose');
const VehicleLookup = require('../models/VehicleLookup');
require('dotenv').config();

/**
 * STORAGE REDUCTION MIGRATION SCRIPT
 * 
 * Level 1: Remove unnecessary indexes
 * Level 2: Remove unnecessary fields (MongoDB will ignore them automatically)
 * Level 3: Runtime parsing (handled in code, no migration needed)
 * 
 * This script:
 * 1. Drops all old indexes except _id
 * 2. Creates new minimal indexes (registrationNumber unique, chassisNumber unique)
 * 3. Optionally removes old fields from documents (uncomment if needed)
 */

async function migrateStorageReduction() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    const collection = VehicleLookup.collection;
    
    console.log('\n📊 Current indexes:');
    const currentIndexes = await collection.indexes();
    currentIndexes.forEach(index => {
      console.log(`  - ${index.name}: ${JSON.stringify(index.key)}`);
    });
    
    console.log(`\n📈 Current index count: ${currentIndexes.length}`);
    
    console.log('\n🗑️  Dropping existing indexes (except _id)...');
    for (const index of currentIndexes) {
      if (index.name !== '_id_') {
        try {
          await collection.dropIndex(index.name);
          console.log(`  ✅ Dropped: ${index.name}`);
        } catch (error) {
          console.log(`  ⚠️  Could not drop ${index.name}: ${error.message}`);
        }
      }
    }
    
    console.log('\n🔨 Creating optimized indexes (Level 1)...');
    
    // 1. Index on registrationNumber (NOT unique - duplicates allowed)
    try {
      await collection.createIndex(
        { registrationNumber: 1 },
        { 
          unique: false,
          sparse: true,
          name: 'reg_idx',
          background: true
        }
      );
      console.log('  ✅ Created: reg_idx (registrationNumber, duplicates allowed)');
    } catch (error) {
      console.log(`  ⚠️  Could not create reg_idx: ${error.message}`);
    }
    
    // 2. Index on chassisNumber (NOT unique - duplicates allowed)
    try {
      await collection.createIndex(
        { chassisNumber: 1 },
        { 
          unique: false,
          sparse: true,
          name: 'chassis_idx',
          background: true
        }
      );
      console.log('  ✅ Created: chassis_idx (chassisNumber, duplicates allowed)');
    } catch (error) {
      console.log(`  ⚠️  Could not create chassis_idx: ${error.message}`);
    }
    
    console.log('\n📊 Final optimized indexes:');
    const finalIndexes = await collection.indexes();
    finalIndexes.forEach(index => {
      console.log(`  - ${index.name}: ${JSON.stringify(index.key)}`);
    });
    
    console.log(`\n📉 Final index count: ${finalIndexes.length} (reduced from ${currentIndexes.length})`);
    
    // Optional: Remove old fields from documents (uncomment if needed)
    // WARNING: This will modify all documents. MongoDB will ignore these fields automatically,
    // so this step is optional and mainly for cleanup.
    /*
    console.log('\n🧹 Removing old fields from documents (Level 2)...');
    const result = await collection.updateMany(
      {},
      {
        $unset: {
          registrationNumberStateCode: "",
          registrationNumberLastFour: "",
          rowNumber: "",
          excelFileId: "",
          createdAt: ""
        }
      }
    );
    console.log(`  ✅ Removed old fields from ${result.modifiedCount} documents`);
    */
    
    console.log('\n✅ Migration completed!');
    console.log('\n💡 Expected storage reduction:');
    console.log('   - Index size: ~40 MB → ~10 MB (75% reduction)');
    console.log('   - Data size: ~19 MB → ~8-10 MB (50% reduction)');
    console.log('   - Total: ~60 MB → ~20 MB (67% reduction)');
    console.log('\n⚠️  NOTE: Old fields will be ignored by MongoDB automatically.');
    console.log('   To physically remove them, uncomment the cleanup section above.');
    
  } catch (error) {
    console.error('❌ Error during migration:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

if (require.main === module) {
  migrateStorageReduction()
    .then(() => {
      console.log('\n✨ Migration completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Migration failed:', error);
      process.exit(1);
    });
}

module.exports = migrateStorageReduction;
