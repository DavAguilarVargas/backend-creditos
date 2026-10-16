const express = require('express');
const router = express.Router();
const integracionesController = require('./integraciones.controller');

// CU03: Endpoint para consultar el historial crediticio externo
router.get('/riesgo/:ci', integracionesController.consultarRiesgoCrediticio);

// CU11: Endpoint para solicitar desembolso al Core Bancario
router.post('/core/desembolsar', integracionesController.procesarDesembolsoCore);

module.exports = router;