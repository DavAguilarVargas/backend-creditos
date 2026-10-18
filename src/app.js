const express = require('express');
const cors = require('cors');
require('dotenv').config();
if (!process.env.JWT_SECRET) {
  throw new Error(
    'Error de configuración: JWT_SECRET es obligatorio.'
  );
}
const db = require('./config/db');

// Rutas Importadas
const authRoutes = require('./modules/auth/auth.routes');
const usuariosRoutes = require('./modules/usuarios/usuarios.routes');
const clientesRoutes = require('./modules/clientes/clientes.routes');
const solicitudesRoutes = require('./modules/solicitudes/solicitudes.routes');
const evaluacionesRoutes = require('./modules/evaluaciones/evaluaciones.routes');
const creditosRoutes = require('./modules/creditos/creditos.routes');
const pagosRoutes = require('./modules/pagos/pagos.routes');
const integracionesRoutes = require('./modules/integraciones/integraciones.routes'); // <-- NUEVO
const reportesRoutes = require('./modules/reportes/reportes.routes');
const garantiasRoutes = require('./modules/garantias/garantias.routes');
const configuracionInstitucionRoutes = require('./modules/configuracion-institucion/configuracion.routes');
const auditoriaRoutes = require('./modules/auditoria/auditoria.routes');

const app = express();

// Permitir peticiones desde tu frontend en Vercel
app.use(cors({
  origin: '*', // O la URL de tu frontend: 'https://tu-proyecto.vercel.app'
  credentials: true
}));
app.use(express.json());

// Montaje de Endpoints rutas API RESTful
app.use('/api/auth', authRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/clientes', clientesRoutes);//
app.use('/api/solicitudes', solicitudesRoutes);//
app.use('/api/evaluaciones', evaluacionesRoutes);//
app.use('/api/creditos', creditosRoutes); //
app.use('/api/pagos', pagosRoutes);
app.use('/api/integraciones', integracionesRoutes);
app.use('/api/reportes', reportesRoutes)
app.use('/api/garantias', garantiasRoutes);;//
app.use('/api/configuracion-institucion', configuracionInstitucionRoutes);
app.use('/api/auditoria', auditoriaRoutes);
// Reemplaza el app.get('/api/health') anterior por este:
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Servidor corriendo correctamente',
  });
});
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en el puerto ${PORT}`);
});