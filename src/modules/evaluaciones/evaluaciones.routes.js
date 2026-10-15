const express = require('express');
const router = express.Router();
const evaluacionesController = require('./evaluaciones.controller');
const { verificarToken, verificarRol } = require('../../middlewares/auth');

router.post('/', verificarToken, verificarRol(['ADMIN', 'ANALISTA']), evaluacionesController.evaluarSolicitud);

module.exports = router;