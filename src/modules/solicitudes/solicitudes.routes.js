const express = require('express');
const router = express.Router();
const solicitudesController = require('./solicitudes.controller');
const { verificarToken, verificarRol } = require('../../middlewares/auth');

router.post('/', verificarToken, verificarRol(['ADMIN', 'OFICIAL']), solicitudesController.registrarSolicitud);
router.get('/', verificarToken, solicitudesController.obtenerSolicitudes);

module.exports = router;
