const express = require('express');
const router = express.Router();
const solicitudesController = require('./solicitudes.controller');
const { verificarToken, verificarRol } = require('../../middlewares/auth');

router.post('/', verificarToken, verificarRol(['ADMIN', 'OFICIAL']), solicitudesController.crearSolicitud);
router.get('/', verificarToken, solicitudesController.listarSolicitudes);

module.exports = router;