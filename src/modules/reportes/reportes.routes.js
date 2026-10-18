
const express = require('express');
const router = express.Router();
const reportesController = require('./reportes.controller');
const { verificarToken, verificarRol } = require('../../middlewares/auth');

// CU14: reportes gerenciales para ADMIN y GERENTE.
const rolesAutorizados = ['ADMIN', 'GERENTE'];

router.use(verificarToken, verificarRol(rolesAutorizados));

router.get('/cartera', reportesController.cartera);
router.get('/mora', reportesController.mora);
router.get('/pagos', reportesController.pagos);
router.get('/creditos', reportesController.creditos);

module.exports = router;
