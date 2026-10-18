const db = require('../../config/db');

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

exports.listarEventos = async (req, res) => {
  try {
    const { desde, hasta, operacion, usuario, entidad } = req.query;
    const where = [];
    const params = [];
    const add = (sql, value) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };

    if (desde) {
      if (!validDate(desde)) return res.status(400).json({ error: 'La fecha desde debe usar YYYY-MM-DD.' });
      add("a.fecha_hora >= ((?::date::timestamp AT TIME ZONE 'America/La_Paz') AT TIME ZONE 'UTC')", desde);
    }
    if (hasta) {
      if (!validDate(hasta)) return res.status(400).json({ error: 'La fecha hasta debe usar YYYY-MM-DD.' });
      add("a.fecha_hora < (((?::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'America/La_Paz') AT TIME ZONE 'UTC')", hasta);
    }
    if (desde && hasta && desde > hasta) {
      return res.status(400).json({ error: 'La fecha desde no puede ser posterior a la fecha hasta.' });
    }
    if (operacion && String(operacion).trim()) {
      add('a.operacion ILIKE ?', `%${String(operacion).trim().slice(0, 60)}%`);
    }
    if (entidad && String(entidad).trim()) {
      add('a.entidad ILIKE ?', `%${String(entidad).trim().slice(0, 40)}%`);
    }
    if (usuario) {
      const idUsuario = Number(usuario);
      if (!Number.isInteger(idUsuario) || idUsuario <= 0) {
        return res.status(400).json({ error: 'El identificador de usuario no es válido.' });
      }
      add('a.id_usuario = ?', idUsuario);
    }

    const sql = `
      SELECT
        a.id_auditoria,
        to_char((a.fecha_hora AT TIME ZONE 'UTC') AT TIME ZONE 'America/La_Paz',
                'YYYY-MM-DD HH24:MI:SS') AS fecha_hora,
        a.id_usuario,
        u.nombre_completo AS usuario,
        u.login,
        a.operacion,
        a.entidad,
        a.id_entidad,
        a.resultado
      FROM public.auditoria a
      INNER JOIN public.usuario u ON u.id_usuario = a.id_usuario
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.fecha_hora DESC, a.id_auditoria DESC
      LIMIT 500`;
    const result = await db.query(sql, params);
    return res.json({ eventos: result.rows });
  } catch (error) {
    console.error('Error al consultar auditoría:', error);
    return res.status(500).json({ error: 'No fue posible consultar la auditoría.' });
  }
};
