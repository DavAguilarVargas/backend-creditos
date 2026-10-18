const express = require('express');
const router = express.Router();
const creditosController = require('./creditos.controller');
const { verificarToken, verificarRol } = require('../../middlewares/auth');

router.post(
  '/evaluar',
  verificarToken,
  verificarRol(['ADMIN', 'JEFE']),
  creditosController.aprobarORechazar
);

// Listado real de créditos pendientes y operaciones registradas para CU11.
router.get(
  '/desembolsos/listado',
  verificarToken,
  verificarRol(['ADMIN', 'OFICIAL']),
  creditosController.listarDesembolsos
);

// El backend registra únicamente desembolsos confirmados fuera del sistema.
router.post(
  '/desembolsar',
  verificarToken,
  verificarRol(['ADMIN', 'OFICIAL']),
  creditosController.desembolsarCredito
);

// El operador autorizado confirma que revisó la firma física y resguardó el contrato.
router.post(
  '/:id/contrato/confirmar-firma',
  verificarToken,
  verificarRol(['ADMIN', 'OFICIAL']),
  creditosController.confirmarFirmaContrato
);

router.get(
  '/:id',
  verificarToken,
  verificarRol(['ADMIN', 'JEFE', 'OFICIAL']),
  creditosController.obtenerCreditoConCuotas
);

module.exports = router;
