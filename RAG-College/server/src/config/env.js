const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

module.exports = {
  PORT: parseInt(process.env.PORT, 10) || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGO_URI: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/rag_production_college',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  JWT_SECRET: process.env.JWT_SECRET || 'your_super_secret_jwt_key_here_change_in_production',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  EMBEDDING_MODEL: process.env.EMBEDDING_MODEL || 'mxbai-embed-large',
  LLM_MODEL: process.env.LLM_MODEL || 'qwen2.5-coder:3b',
  SIGLIP_BASE_URL: process.env.SIGLIP_BASE_URL || 'http://127.0.0.1:8000'
};