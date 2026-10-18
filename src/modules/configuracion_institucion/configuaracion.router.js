const express = require('express');
const router = express.Router();
const controller = require('./configuracion.controller');
const { verificarToken, verificarRol } = require('../../middlewares/auth');

// Solo identidad y contacto institucionales públicos; no expone CI/facultades del representante.
router.get('/', controller.obtenerConfiguracion);

// Los datos del compareciente y las facultades solo se entregan a ADMIN.
router.get('/admin', verificarToken, verificarRol(['ADMIN']), controller.obtenerConfiguracionAdmin);

// Solo ADMIN puede modificar marca, datos institucionales y datos del compareciente.
router.put('/', verificarToken, verificarRol(['ADMIN']), controller.actualizarConfiguracion);

module.exports = router;
