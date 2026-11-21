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

async function connectSqlDB() {
  try {
    const activePool = getSqlPool();
    const conn = await activePool.getConnection();
    await conn.ping();
    conn.release();
    console.log(`[MySQL] Connected successfully: ${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE}`);
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
  querySql
};