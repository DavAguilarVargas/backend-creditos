const express = require('express');
const router = express.Router();
const usuariosController = require('./usuarios.controller');

// Endpoints de gestión de usuarios
router.post('/', usuariosController.crearUsuario);
router.get('/', usuariosController.listarUsuarios);

module.exports = router;