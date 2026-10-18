const express = require('express');
const router = express.Router();
const controller = require('./garantias.controller');
const { verificarToken, verificarRol } = require('../../middlewares/auth');

const rolesPermitidos = ['ADMIN', 'OFICIAL'];

router.get('/', verificarToken, verificarRol(rolesPermitidos), controller.obtenerGarantias);
router.post('/', verificarToken, verificarRol(rolesPermitidos), controller.registrarGarantia);
router.patch('/:id/estado', verificarToken, verificarRol(rolesPermitidos), controller.liberarGarantia);

module.exports = router;
