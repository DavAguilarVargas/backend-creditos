const db = require('../../config/db');

exports.registrarPago = async (req, res) => {
  const { id_cuota, monto, forma_pago } = req.body;
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const cuotaRes = await client.query('SELECT * FROM cuota WHERE id_cuota = $1 FOR UPDATE', [id_cuota]);
    if (cuotaRes.rows.length === 0) return res.status(404).json({ error: 'Cuota no encontrada' });
    
    const cuota = cuotaRes.rows[0];
    if (cuota.estado === 'PAGADA') {
      throw new Error('La cuota ya se encuentra cancelada.');
    }

    const recibo = `REC-${Date.now().toString().slice(-6)}`;
    await client.query(
      `INSERT INTO pago (id_cuota, fecha_pago, monto, forma_pago, numero_recibo)
       VALUES ($1, NOW(), $2, $3, $4)`,
      [id_cuota, monto, forma_pago || 'EFECTIVO', recibo]
    );

    await client.query(
      "UPDATE cuota SET estado = 'PAGADA', saldo = 0 WHERE id_cuota = $1",
      [id_cuota]
    );

    await client.query(
      `UPDATE credito SET saldo_capital = saldo_capital - $1 WHERE id_credito = $2`,
      [cuota.capital, cuota.id_credito]
    );

    const credRes = await client.query('SELECT saldo_capital FROM credito WHERE id_credito = $1', [cuota.id_credito]);
    if (parseFloat(credRes.rows[0].saldo_capital) <= 0) {
      await client.query("UPDATE credito SET estado = 'CANCELADO' WHERE id_credito = $1", [cuota.id_credito]);
    }

    await client.query('COMMIT');
    res.json({ mensaje: 'Pago registrado exitosamente', numero_recibo: recibo });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

exports.reporteResumen = async (req, res) => {
  try {
    const resumen = await db.query(`
      SELECT 
        COUNT(id_credito) AS total_creditos,
        COALESCE(SUM(monto_aprobado), 0) AS monto_total_otorgado,
        COALESCE(SUM(saldo_capital), 0) AS saldo_pendiente
      FROM credito
    `);

    const mora = await db.query(`
      SELECT COUNT(*) AS cuotas_vencidas 
      FROM cuota 
      WHERE fecha_vencimiento < CURRENT_DATE AND estado = 'PENDIENTE'
    `);

    res.json({
      resumen_cartera: resumen.rows[0],
      mora: mora.rows[0]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};