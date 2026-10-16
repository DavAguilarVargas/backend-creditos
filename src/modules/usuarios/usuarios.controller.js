const bcrypt = require('bcryptjs');
const db = require('../../config/db');

// Registrar un nuevo usuario con hashing individual de contraseña
// POST /api/usuarios
const crearUsuario = async (req, res) => {
  try {
    const { login, clave, nombre, rol } = req.body;

    // Validar campos requeridos
    if (!login || !clave || !nombre || !rol) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

  // Hashear la contraseña recibida del frontend
    const salt = await bcrypt.genSalt(10);
    const claveHash = await bcrypt.hash(clave, salt);

    // Insertar usando los nombres reales de la tabla Supabase: clave_hash y nombre_completo
    const result = await pool.query(
      `INSERT INTO usuario (login, clave_hash, nombre_completo, rol, activo) 
       VALUES ($1, $2, $3, $4, true) 
       RETURNING id_usuario, login, nombre_completo AS nombre, rol, activo`,
      [login, claveHash, nombre, rol]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error al registrar usuario:', error);
    res.status(500).json({ 
      error: 'Error interno al registrar usuario', 
      detalle: error.message 
    });
  }
};
// Listar todos los usuarios
// GET /api/usuarios
const listarUsuarios = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id_usuario, login, nombre_completo AS nombre, rol, activo 
       FROM usuario 
       ORDER BY id_usuario ASC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error al listar usuarios:', error);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
};

module.exports = {
  crearUsuario,
  listarUsuarios
};