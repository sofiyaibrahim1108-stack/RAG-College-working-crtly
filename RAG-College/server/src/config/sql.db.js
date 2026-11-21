const mysql = require('mysql2/promise');
const {
  MYSQL_HOST,
  MYSQL_PORT,
  MYSQL_USER,
  MYSQL_PASSWORD,
  MYSQL_DATABASE
} = require('./env');

let pool = null;

function getSqlPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: MYSQL_HOST,
      port: MYSQL_PORT,
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      database: MYSQL_DATABASE,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      dateStrings: true // Keeps DATE / DATETIME clean as strings without TZ shift
    });
  }
  return pool;
}

async function initSqlRegistryTable() {
  const activePool = getSqlPool();
  const createTableSql = `
    CREATE TABLE IF NOT EXISTS sql_dataset_registry (
      id INT AUTO_INCREMENT PRIMARY KEY,
      file_name VARCHAR(255) NOT NULL,
      file_hash VARCHAR(64) NOT NULL,
      file_type VARCHAR(20) NOT NULL,
      sheet_name VARCHAR(100) DEFAULT NULL,
      target_table VARCHAR(100) NOT NULL,
      dataset_description TEXT,
      generated_summary TEXT,
      columns_json JSON,
      column_mapping_json JSON,
      row_count INT NOT NULL DEFAULT 0,
      inserted_row_count INT NOT NULL DEFAULT 0,
      upload_status ENUM('pending', 'completed', 'failed') NOT NULL DEFAULT 'pending',
      embedding_status ENUM('pending', 'processing', 'completed', 'failed', 'deleted') NOT NULL DEFAULT 'pending',
      embedding_error TEXT DEFAULT NULL,
      embedding_ref VARCHAR(120) DEFAULT NULL,
      uploaded_by VARCHAR(64) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_registry_hash_table (file_hash, target_table),
      INDEX idx_registry_target_table (target_table),
      INDEX idx_registry_embedding_status (embedding_status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `;

  await activePool.execute(createTableSql);
  console.log('[MySQL] Master Data Registry table (sql_dataset_registry) verified.');
}

async function connectSqlDB() {
  try {
    const activePool = getSqlPool();
    const conn = await activePool.getConnection();
    await conn.ping();
    conn.release();
    console.log(`[MySQL] Connected successfully: ${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE}`);

    await initSqlRegistryTable();
    return activePool;
  } catch (err) {
    console.warn(`[MySQL] Connection warning: ${err.message}`);
    return null;
  }
}

async function querySql(sql, params = []) {
  const activePool = getSqlPool();
  const [rows] = await activePool.execute(sql, params);
  return rows;
}

module.exports = {
  getSqlPool,
  connectSqlDB,
  querySql,
  initSqlRegistryTable
};