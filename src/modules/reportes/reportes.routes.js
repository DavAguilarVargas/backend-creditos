const express = require('express');
const router = express.Router();
const reportesController = require('./reportes.controller');

// CU14: Endpoints de Reportes Gerenciales
router.get('/cartera', reportesController.obtenerReporteCartera);
router.get('/mora', reportesController.obtenerReporteMora);
router.get('/pagos', reportesController.obtenerReportePagos);

module.exports = router;