const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const jwtSecret = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here_change_in_production';
const nodeEnv = process.env.NODE_ENV || 'development';

// Strict production validation for insecure default JWT secret
if (nodeEnv === 'production' && jwtSecret === 'your_super_secret_jwt_key_here_change_in_production') {
  console.error('FATAL ERROR: Default insecure JWT_SECRET is configured in production mode.');
  process.exit(1);
}

module.exports = {
  PORT: parseInt(process.env.PORT, 10) || 5000,
  NODE_ENV: nodeEnv,
  MONGO_URI: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/rag_production_college',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  JWT_SECRET: jwtSecret,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  
  // ONNX Embedding Model Config (Aligned with embedding.service.js)
  ONNX_EMBEDDING_MODEL: process.env.ONNX_EMBEDDING_MODEL || 'Xenova/bge-large-en-v1.5',
  EMBEDDING_BATCH_SIZE: parseInt(process.env.EMBEDDING_BATCH_SIZE, 10) || 36,
  
  LLM_MODEL: process.env.LLM_MODEL || 'qwen2.5-coder:3b',
  SIGLIP_BASE_URL: process.env.SIGLIP_BASE_URL || 'http://127.0.0.1:8000',

  // Vector Search Pool Constants (Fixes NaN query limit bug)
  VECTOR_POOL_MIN_UNFILTERED: parseInt(process.env.VECTOR_POOL_MIN_UNFILTERED, 10) || 20,
  VECTOR_POOL_MULTIPLIER_UNFILTERED: parseInt(process.env.VECTOR_POOL_MULTIPLIER_UNFILTERED, 10) || 4,
  VECTOR_POOL_MIN_FILTERED: parseInt(process.env.VECTOR_POOL_MIN_FILTERED, 10) || 40,
  VECTOR_POOL_MULTIPLIER_FILTERED: parseInt(process.env.VECTOR_POOL_MULTIPLIER_FILTERED, 10) || 8,
  VECTOR_POOL_RETRY_MIN: parseInt(process.env.VECTOR_POOL_RETRY_MIN, 10) || 100,
  VECTOR_POOL_RETRY_MULTIPLIER: parseInt(process.env.VECTOR_POOL_RETRY_MULTIPLIER, 10) || 20,

  // Google Drive OAuth Config
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/drive/callback'
};  