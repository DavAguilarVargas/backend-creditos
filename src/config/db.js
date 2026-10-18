const { Pool } = require('pg');
const dns = require('dns');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  // Mantener el comportamiento actual de resolución IPv4 usado por el backend.
  lookup: (hostname, options, callback) => dns.lookup(hostname, { family: 4 }, callback),
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  // Usado por procesos de una sola ejecución, como el Cron Job de control de mora.
  close: () => pool.end(),
};