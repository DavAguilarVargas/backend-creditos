const express = require('express');
const router = express.Router();
const pagosController = require('./pagos.controller');
const { verificarToken, verificarRol } = require('../../middlewares/auth');

const rolesCaja = ['ADMIN', 'CAJERO'];

// Buscar por número de crédito, ID interno o CI (si la CI identifica un solo crédito).
router.get(
  '/buscar/:identificador',
  verificarToken,
  verificarRol(rolesCaja),
  pagosController.buscarCreditoParaPago
);

// Registrar pago completo de una cuota, con control transaccional.
router.post(
  '/',
  verificarToken,
  verificarRol(rolesCaja),
  pagosController.registrarPago
);

// Ejecutar CU13 manualmente; el proceso es idempotente.
router.post(
  '/control-mora',
  verificarToken,
  verificarRol(rolesCaja),
  pagosController.controlarMora
);

router.get(
  '/reporte',
  verificarToken,
  verificarRol(['ADMIN', 'CAJERO', 'GERENTE']),
  pagosController.reporteResumen
);

module.exports = router;
