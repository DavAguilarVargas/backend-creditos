const db = require('../../config/db');

exports.crearSolicitud = async (req, res) => {
  const { id_cliente, monto_solicitado, plazo_meses, destino } = req.body;

  if (!id_cliente || !monto_solicitado || !plazo_meses) {
    return res.status(400).json({ error: 'Campos requeridos: id_cliente, monto_solicitado, plazo_meses.' });
  }

  try {
    const result = await db.query(
      `INSERT INTO solicitud_credito (id_cliente, monto_solicitado, plazo_meses, destino, estado)
       VALUES ($1, $2, $3, $4, 'REGISTRADA') RETURNING *`,
      [id_cliente, monto_solicitado, plazo_meses, destino]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.listarSolicitudes = async (req, res) => {
  try {
    const query = `
      SELECT s.*, c.nombres, c.apellidos, c.ci
      FROM solicitud_credito s
      JOIN cliente c ON s.id_cliente = c.id_cliente
      ORDER BY s.id_solicitud DESC
    `;
    const result = await db.query(query);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};