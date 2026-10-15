const express = require('express');
const router = express.Router();
const pagosController = require('./pagos.controller');
const { verificarToken, verificarRol } = require('../../middlewares/auth');

router.post('/', verificarToken, verificarRol(['ADMIN', 'CAJERO']), pagosController.registrarPago);
router.get('/reporte', verificarToken, pagosController.reporteResumen);

module.exports = router;