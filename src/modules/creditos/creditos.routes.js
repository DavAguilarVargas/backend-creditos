const express = require('express');
const router = express.Router();
const creditosController = require('./creditos.controller');
const { verificarToken, verificarRol } = require('../../middlewares/auth');

router.post('/aprobacion', verificarToken, verificarRol(['ADMIN', 'JEFE']), creditosController.aprobarORechazar);
router.post('/desembolso', verificarToken, verificarRol(['ADMIN', 'OFICIAL']), creditosController.desembolsarCredito);
router.get('/:id', verificarToken, creditosController.obtenerCreditoConCuotas);

module.exports = router;