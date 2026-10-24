const mongoose = require('mongoose');

const connectDB = async () => {
  let envUri = process.env.MONGO_URI ? String(process.env.MONGO_URI).trim().replace(/^["']|["']$/g, '') : '';
  
  // Valid scheme illana direct default string-ku force panrom
  if (!envUri.startsWith('mongodb://') && !envUri.startsWith('mongodb+srv://')) {
    envUri = 'mongodb://127.0.0.1:27017/rag_production_college';
  }

  try {
    const conn = await mongoose.connect(envUri, {
      autoIndex: true
    });
    console.log(`[MongoDB] Connected successfully: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (error) {
    console.error(`[MongoDB] Connection error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;