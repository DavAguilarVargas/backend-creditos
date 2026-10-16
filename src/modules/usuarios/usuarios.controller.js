const bcrypt = require('bcryptjs');
const db = require('../../config/db');

// Registrar un nuevo usuario con hashing individual de contraseña
const crearUsuario = async (req, res) => {
  try {
    const { login, clave, nombre, rol } = req.body;

    // Validar campos requeridos
    if (!login || !clave || !nombre || !rol) {
      return res.status(400).json({ error: 'Todos los campos (login, clave, nombre, rol) son obligatorios' });
    }

    // Verificar si el login ya existe
    const existe = await db.query('SELECT id_usuario FROM usuario WHERE login = $1', [login]);
    if (existe.rows.length > 0) {
      return res.status(400).json({ error: 'El nombre de usuario (login) ya está registrado' });
    }

    // Encriptar la contraseña individual con salt factor de 10
    const saltRounds = 10;
    const claveHash = await bcrypt.hash(clave, saltRounds);

    // Insertar el nuevo usuario en Supabase
    const result = await db.query(
      `INSERT INTO usuario (login, clave, nombre, rol, estado) 
       VALUES ($1, $2, $3, $4, 'ACTIVO') 
       RETURNING id_usuario, login, nombre, rol, estado`,
      [login, claveHash, nombre, rol]
    );

    res.status(201).json({
      mensaje: 'Usuario registrado exitosamente',
      usuario: result.rows[0]
    });
  } catch (error) {
    console.error('Error al registrar usuario:', error);
    res.status(500).json({ error: 'Error interno del servidor al crear el usuario' });
  }
};

// Listar todos los usuarios
const listarUsuarios = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id_usuario, login, nombre, rol, estado FROM usuario ORDER BY id_usuario ASC'
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