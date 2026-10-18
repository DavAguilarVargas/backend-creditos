
const express = require('express');
const router = express.Router();
const usuariosController = require('./usuarios.controller');
const { verificarToken, verificarRol } = require('../../middlewares/auth');

// CU15: solo ADMIN puede gestionar usuarios.
router.use(verificarToken, verificarRol(['ADMIN']));

router.post('/', usuariosController.crearUsuario);
router.get('/', usuariosController.listarUsuarios);
router.put('/:id', usuariosController.modificarUsuario);
router.patch('/:id/estado', usuariosController.cambiarEstadoUsuario);

module.exports = router;
