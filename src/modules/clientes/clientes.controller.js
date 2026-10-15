const db = require('../../config/db');

exports.registrarCliente = async (req, res) => {
  const { ci, nombres, apellidos, telefono, direccion, ingresos_mensuales } = req.body;

  if (!ci || !nombres || !apellidos) {
    return res.status(400).json({ error: 'Campos requeridos: ci, nombres, apellidos.' });
  }

  try {
    const existe = await db.query('SELECT id_cliente FROM cliente WHERE ci = $1', [ci]);
    if (existe.rows.length > 0) {
      return res.status(400).json({ error: 'El CI ya se encuentra registrado.' });
    }

    const result = await db.query(
      `INSERT INTO cliente (ci, nombres, apellidos, telefono, direccion, ingresos_mensuales)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [ci, nombres, apellidos, telefono, direccion, ingresos_mensuales || 0]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.obtenerClientes = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM cliente ORDER BY id_cliente DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};