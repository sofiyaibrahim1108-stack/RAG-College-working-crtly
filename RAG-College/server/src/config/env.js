const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

module.exports = {
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGO_URI: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/rag_production_college',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  EMBEDDING_MODEL: process.env.EMBEDDING_MODEL || 'mxbai-embed-large',
  LLM_MODEL: process.env.LLM_MODEL || 'qwen2.5-coder:latest',
  SIGLIP_BASE_URL: process.env.SIGLIP_BASE_URL || 'http://127.0.0.1:5001',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/drive/callback',
  VECTOR_POOL_MIN_UNFILTERED: parseInt(process.env.VECTOR_POOL_MIN_UNFILTERED || '30', 10),
  VECTOR_POOL_MULTIPLIER_UNFILTERED: parseInt(process.env.VECTOR_POOL_MULTIPLIER_UNFILTERED || '5', 10),
  VECTOR_POOL_MIN_FILTERED: parseInt(process.env.VECTOR_POOL_MIN_FILTERED || '100', 10),
  VECTOR_POOL_MULTIPLIER_FILTERED: parseInt(process.env.VECTOR_POOL_MULTIPLIER_FILTERED || '20', 10),
  VECTOR_POOL_RETRY_MIN: parseInt(process.env.VECTOR_POOL_RETRY_MIN || '250', 10),
  VECTOR_POOL_RETRY_MULTIPLIER: parseInt(process.env.VECTOR_POOL_RETRY_MULTIPLIER || '50', 10)
};