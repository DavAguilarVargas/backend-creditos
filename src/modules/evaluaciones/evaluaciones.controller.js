const db = require('../../config/db');

exports.evaluarSolicitud = async (req, res) => {
  const { id_solicitud, ingresos, gastos, nivel_riesgo } = req.body;

  if (!id_solicitud || ingresos === undefined || gastos === undefined) {
    return res.status(400).json({ error: 'Campos requeridos: id_solicitud, ingresos, gastos.' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const capacidad_pago = parseFloat(ingresos) - parseFloat(gastos);
    const resultado = capacidad_pago > 0 ? 'FAVORABLE' : 'DESFAVORABLE';

    const evalResult = await client.query(
      `INSERT INTO evaluacion_credito (id_solicitud, fecha_evaluacion, ingresos, gastos, capacidad_pago, nivel_riesgo, resultado)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6) RETURNING *`,
      [id_solicitud, ingresos, gastos, capacidad_pago, nivel_riesgo || 'MEDIO', resultado]
    );

    await client.query(
      "UPDATE solicitud_credito SET estado = 'EN_EVALUACION' WHERE id_solicitud = $1",
      [id_solicitud]
    );

    await client.query('COMMIT');
    res.status(201).json(evalResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};