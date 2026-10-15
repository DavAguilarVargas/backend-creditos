const { Pool } = require('pg');
const dns = require('dns');
require('dotenv').config();

// Forzar a Node.js a resolver direcciones IPv4 primero
dns.setDefaultResultOrder('ipv4first');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.on('connect', () => {
  console.log('✅ Conectado a la base de datos de Supabase');
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect()
};