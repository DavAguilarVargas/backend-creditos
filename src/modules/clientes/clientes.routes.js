const express = require('express');
const router = express.Router();
const clientesController = require('./clientes.controller');
const { verificarToken, verificarRol } = require('../../middlewares/auth');

router.post('/', verificarToken, verificarRol(['ADMIN', 'OFICIAL']), clientesController.registrarCliente);
router.get('/', verificarToken, clientesController.obtenerClientes);

module.exports = router;