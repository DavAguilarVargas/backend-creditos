const { Pool } = require('pg');
const dns = require('dns');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  // Forzar al conector pg a resolver única y estrictamente IPv4 (family: 4)
  lookup: (hostname, options, callback) => {
    dns.lookup(hostname, { family: 4 }, callback);
  }
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect()
};