const express = require('express');
const router = express.Router();
const integracionesController = require('./integraciones.controller');
const { verificarToken, verificarRol } = require('../../middlewares/auth');

// La consulta de riesgo es una simulación; requiere usuario autenticado.
router.get(
  '/riesgo/:ci',
  verificarToken,
  verificarRol(['ADMIN', 'ANALISTA']),
  integracionesController.consultarRiesgoCrediticio
);

// API Core de demostración, protegida y explícitamente no monetaria.
router.post(
  '/core/desembolsar',
  verificarToken,
  verificarRol(['ADMIN', 'OFICIAL']),
  integracionesController.procesarDesembolsoCore
);

module.exports = router;
