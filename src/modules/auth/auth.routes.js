//RUTAS
const express = require('express');
const router = express.Router();
const authController = require('./auth.controller');

router.post('/login', authController.login);
router.get('/semilla', authController.crearSemilla);

module.exports = router;