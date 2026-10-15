//Módulo de Autenticación - Controlador
const db = require('../../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// 1. Inicio de sesión
exports.login = async (req, res) => {
  const { login, clave } = req.body;

  if (!login || !clave) {
    return res.status(400).json({ error: 'Debes proporcionar login y contraseña.' });
  }

  try {
    const result = await db.query('SELECT * FROM usuario WHERE login = $1 AND activo = true', [login]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales incorrectas o usuario inactivo.' });
    }

    const usuario = result.rows[0];
    const claveValida = await bcrypt.compare(clave, usuario.clave_hash);

    if (!claveValida) {
      return res.status(401).json({ error: 'Credenciales incorrectas.' });
    }

    const token = jwt.sign(
      { 
        id_usuario: usuario.id_usuario, 
        login: usuario.login, 
        rol: usuario.rol,
        nombre: usuario.nombre_completo 
      },
      process.env.JWT_SECRET || 'secreto_desarrollo',
      { expiresIn: '8h' }
    );

    res.json({
      mensaje: 'Inicio de sesión exitoso',
      token,
      usuario: {
        id: usuario.id_usuario,
        nombre: usuario.nombre_completo,
        login: usuario.login,
        rol: usuario.rol
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 2. Generador temporal de contraseñas
exports.crearSemilla = async (req, res) => {
  try {
    const hash = await bcrypt.hash('admin123', 10);
    await db.query('UPDATE usuario SET clave_hash = $1', [hash]);
    res.json({ 
      mensaje: 'Contraseñas de todos los usuarios actualizadas a: admin123', 
      hashGenerado: hash 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};