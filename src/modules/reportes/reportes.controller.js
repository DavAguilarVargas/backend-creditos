// ============================================================================
// MÓDULO DE REPORTES OPERATIVOS Y GERENCIALES (CU14)
// ============================================================================
const db = require('../../config/db');

// Reporte General de Cartera por Estado
const obtenerReporteCartera = async (req, res) => {
  try {
    const consulta = `
      SELECT 
        c.estado,
        COUNT(c.id_credito) AS total_creditos,
        SUM(c.monto_aprobado) AS monto_total_otorgado,
        SUM(c.saldo_capital) AS saldo_pendiente_total
      FROM credito c
      GROUP BY c.estado;
    `;
    const result = await db.query(consulta);

    res.json({
      fecha_generacion: new Date(),
      resumen_cartera: result.rows
    });
  } catch (error) {
    console.error('Error al generar reporte de cartera:', error);
    res.status(500).json({ error: 'Error al consolidar reporte de cartera' });
  }
};

// Reporte de Créditos en Mora
const obtenerReporteMora = async (req, res) => {
  try {
    const consulta = `
      SELECT 
        c.id_credito,
        c.numero_credito,
        cli.nombres || ' ' || cli.apellidos AS nombre_cliente,
        cli.ci,
        c.saldo_capital,
        COUNT(cu.id_cuota) AS cuotas_vencidas,
        SUM(cu.monto_cuota) AS monto_mora_total
      FROM credito c
      JOIN solicitud_credito s ON c.id_solicitud = s.id_solicitud
      JOIN cliente cli ON s.id_cliente = cli.id_cliente
      JOIN cuota cu ON c.id_credito = cu.id_credito
      WHERE cu.estado = 'VENCIDA' OR c.estado = 'EN_MORA'
      GROUP BY c.id_credito, c.numero_credito, cli.nombres, cli.apellidos, cli.ci, c.saldo_capital;
    `;
    const result = await db.query(consulta);

    res.json({
      fecha_generacion: new Date(),
      total_casos_mora: result.rows.length,
      creditos_en_mora: result.rows
    });
  } catch (error) {
    console.error('Error al generar reporte de mora:', error);
    res.status(500).json({ error: 'Error al consultar créditos en mora' });
  }
};

// Reporte de Recaudación / Pagos Realizados
const obtenerReportePagos = async (req, res) => {
  try {
    const consulta = `
      SELECT 
        p.id_pago,
        p.numero_comprobante,
        p.monto_pagado,
        p.fecha_pago,
        c.numero_credito,
        cli.nombres || ' ' || cli.apellidos AS nombre_cliente
      FROM pago p
      JOIN cuota cu ON p.id_cuota = cu.id_cuota
      JOIN credito c ON cu.id_credito = c.id_credito
      JOIN solicitud_credito s ON c.id_solicitud = s.id_solicitud
      JOIN cliente cli ON s.id_cliente = cli.id_cliente
      ORDER BY p.fecha_pago DESC
      LIMIT 100;
    `;
    const result = await db.query(consulta);

    res.json({
      fecha_generacion: new Date(),
      total_registros: result.rows.length,
      pagos: result.rows
    });
  } catch (error) {
    console.error('Error al generar reporte de pagos:', error);
    res.status(500).json({ error: 'Error al consultar historial de pagos' });
  }
};

module.exports = {
  obtenerReporteCartera,
  obtenerReporteMora,
  obtenerReportePagos
};