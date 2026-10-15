const db = require('../../config/db');
const { generarCronogramaFrances } = require('../../utils/amortizacion');

exports.aprobarORechazar = async (req, res) => {
  const { id_solicitud, decision, motivo, tasa_interes } = req.body;
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    if (decision === 'RECHAZAR') {
      if (!motivo) return res.status(400).json({ error: 'El motivo es obligatorio para rechazar.' });
      
      await client.query(
        "UPDATE solicitud_credito SET estado = 'RECHAZADA' WHERE id_solicitud = $1",
        [id_solicitud]
      );
      await client.query('COMMIT');
      return res.json({ mensaje: 'Solicitud rechazada', motivo });
    }

    const solRes = await client.query('SELECT * FROM solicitud_credito WHERE id_solicitud = $1', [id_solicitud]);
    if (solRes.rows.length === 0) return res.status(404).json({ error: 'Solicitud no encontrada.' });
    
    const solicitud = solRes.rows[0];

    await client.query("UPDATE solicitud_credito SET estado = 'APROBADA' WHERE id_solicitud = $1", [id_solicitud]);

    const numCredito = `CR-${Date.now().toString().slice(-6)}`;
    const credRes = await client.query(
      `INSERT INTO credito (id_solicitud, numero_credito, monto_aprobado, tasa_interes, plazo_meses, saldo_capital, estado)
       VALUES ($1, $2, $3, $4, $5, $3, 'APROBADO') RETURNING *`,
      [id_solicitud, numCredito, solicitud.monto_solicitado, tasa_interes || 12.0, solicitud.plazo_meses]
    );

    await client.query('COMMIT');
    res.json({ mensaje: 'Crédito aprobado exitosamente', credito: credRes.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

exports.desembolsarCredito = async (req, res) => {
  const { id_credito } = req.body;
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const credRes = await client.query('SELECT * FROM credito WHERE id_credito = $1', [id_credito]);
    if (credRes.rows.length === 0) return res.status(404).json({ error: 'Crédito no encontrado.' });
    
    const credito = credRes.rows[0];

    const numContrato = `CT-${Date.now().toString().slice(-6)}`;
    await client.query(
      `INSERT INTO contrato (id_credito, numero_contrato, fecha_firma, estado)
       VALUES ($1, $2, CURRENT_DATE, 'FIRMADO')`,
      [id_credito, numContrato]
    );

    const cuotas = generarCronogramaFrances(
      parseFloat(credito.monto_aprobado),
      parseFloat(credito.tasa_interes),
      credito.plazo_meses
    );

    for (const c of cuotas) {
      await client.query(
        `INSERT INTO cuota (id_credito, numero, fecha_vencimiento, capital, interes, monto, saldo, estado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDIENTE')`,
        [id_credito, c.numero, c.fecha_vencimiento, c.capital, c.interes, c.monto, c.saldo]
      );
    }

    await client.query(
      `UPDATE credito SET estado = 'VIGENTE', fecha_desembolso = CURRENT_DATE WHERE id_credito = $1`,
      [id_credito]
    );

    await client.query('COMMIT');
    res.json({ mensaje: 'Desembolso realizado y cronograma generado exitosamente' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

exports.obtenerCreditoConCuotas = async (req, res) => {
  const { id } = req.params;
  try {
    const credRes = await db.query(
      `SELECT cr.*, c.nombres, c.apellidos, c.ci, ct.numero_contrato 
       FROM credito cr
       JOIN solicitud_credito s ON cr.id_solicitud = s.id_solicitud
       JOIN cliente c ON s.id_cliente = c.id_cliente
       LEFT JOIN contrato ct ON ct.id_credito = cr.id_credito
       WHERE cr.id_credito = $1`,
      [id]
    );

    if (credRes.rows.length === 0) return res.status(404).json({ error: 'Crédito no encontrado' });

    const cuotasRes = await db.query('SELECT * FROM cuota WHERE id_credito = $1 ORDER BY numero ASC', [id]);

    res.json({ credito: credRes.rows[0], cuotas: cuotasRes.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};