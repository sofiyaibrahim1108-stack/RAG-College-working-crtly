const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function exportBackup() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGODB_URI not found in .env file!');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Connected to MongoDB for backup...');

  const backupDir = path.resolve(__dirname, './backup_rag_db');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const collections = ['documents', 'documentchunks', 'departments'];

  for (const colName of collections) {
    try {
      const data = await mongoose.connection.db.collection(colName).find({}).toArray();
      const filePath = path.join(backupDir, `${colName}.json`);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      console.log(`Saved ${data.length} records to backup_rag_db/${colName}.json`);
    } catch (e) {
      console.warn(`Could not export ${colName}:`, e.message);
    }
  }

  console.log('\nBackup completed safely!');
  process.exit(0);
}

exportBackup().catch((err) => {
  console.error('Backup failed:', err);
  process.exit(1);
});