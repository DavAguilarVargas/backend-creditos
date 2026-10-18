
const express = require('express');
const router = express.Router();
const controller = require('./auditoria.controller');
const { verificarToken, verificarRol } = require('../../middlewares/auth');

// Auditoría de solo lectura: ADMIN y GERENTE.
router.use(verificarToken, verificarRol(['ADMIN', 'GERENTE']));

router.get('/', controller.listarEventos);

module.exports = router;
