const db = require('../../config/db');

const TIPOS_GARANTIA = new Set(['HIPOTECARIA', 'PRENDARIA', 'PERSONAL', 'DPF']);
const ESTADOS_SOLICITUD_PERMITIDOS = new Set(['REGISTRADA', 'EN_EVALUACION']);

function crearError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function obtenerIdUsuario(req) {
  const id = Number(req.usuario?.id_usuario);
  if (!Number.isInteger(id) || id <= 0) {
    throw crearError(401, 'No se pudo identificar al usuario autenticado.');
  }
  return id;
}

async function registrarAuditoria(client, idUsuario, operacion, idGarantia) {
  await client.query(
    `INSERT INTO public.auditoria
      (id_usuario, operacion, entidad, id_entidad, resultado)
     VALUES ($1, $2, 'GARANTIA', $3, 'EXITO')`,
    [idUsuario, operacion, idGarantia]
  );
}

const SQL_DETALLE_GARANTIA = `
  SELECT
    g.id_garantia,
    g.id_solicitud,
    g.tipo_garantia,
    g.descripcion,
    g.valor_avaluo,
    g.estado,
    g.documento_respaldo_url,
    s.estado AS estado_solicitud,
    s.monto_solicitado,
    s.destino_credito,
    c.id_cliente,
    c.ci AS ci_cliente,
    concat_ws(' ', c.nombres, c.apellidos) AS cliente
  FROM public.garantia g
  INNER JOIN public.solicitud_credito s ON s.id_solicitud = g.id_solicitud
  INNER JOIN public.cliente c ON c.id_cliente = s.id_cliente
`;

exports.obtenerGarantias = async (req, res) => {
  try {
    const params = [];
    let sql = SQL_DETALLE_GARANTIA;

    if (req.query.id_solicitud !== undefined) {
      const idSolicitud = Number(req.query.id_solicitud);
      if (!Number.isInteger(idSolicitud) || idSolicitud <= 0) {
        return res.status(400).json({ error: 'El ID de solicitud no es válido.' });
      }
      sql += ' WHERE g.id_solicitud = $1';
      params.push(idSolicitud);
    }

    sql += ' ORDER BY g.id_garantia DESC';
    const result = await db.query(sql, params);
    return res.json(result.rows);
  } catch (error) {
    console.error('Error al consultar garantías:', error);
    return res.status(500).json({ error: 'No fue posible consultar las garantías.' });
  }
};

exports.registrarGarantia = async (req, res) => {
  let client;
  let transaccionIniciada = false;

  try {
    const idUsuario = obtenerIdUsuario(req);
    const idSolicitud = Number(req.body.id_solicitud);
    const tipo = String(req.body.tipo_garantia || '').trim().toUpperCase();
    const descripcion = String(req.body.descripcion || '').trim();
    const valorRaw = req.body.valor_avaluo;
    const valor = Number(valorRaw);
    const documentoRaw = String(req.body.documento_respaldo_url || '').trim();

    if (!Number.isInteger(idSolicitud) || idSolicitud <= 0) {
      throw crearError(400, 'Debe seleccionar una solicitud válida.');
    }
    if (!TIPOS_GARANTIA.has(tipo)) {
      throw crearError(400, 'Seleccione un tipo de garantía válido.');
    }
    if (!descripcion) {
      throw crearError(400, 'La descripción de la garantía es obligatoria.');
    }
    if (valorRaw === '' || valorRaw == null || !Number.isFinite(valor) || valor < 0) {
      throw crearError(400, 'El valor de avalúo debe ser mayor o igual a cero.');
    }

    let documento = null;
    if (documentoRaw) {
      try {
        const url = new URL(documentoRaw);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Protocolo inválido');
        documento = url.toString();
      } catch {
        throw crearError(400, 'La referencia documental debe ser una URL HTTP o HTTPS válida.');
      }
    }

    client = await db.getClient();
    await client.query('BEGIN');
    transaccionIniciada = true;

    const solicitudResult = await client.query(
      `SELECT id_solicitud, estado
       FROM public.solicitud_credito
       WHERE id_solicitud = $1
       FOR UPDATE`,
      [idSolicitud]
    );

    if (solicitudResult.rowCount === 0) {
      throw crearError(404, 'La solicitud seleccionada no existe.');
    }
    if (!ESTADOS_SOLICITUD_PERMITIDOS.has(String(solicitudResult.rows[0].estado || '').toUpperCase())) {
      throw crearError(409, 'Solo se pueden registrar garantías en solicitudes REGISTRADAS o EN_EVALUACION.');
    }

    const insertResult = await client.query(
      `INSERT INTO public.garantia (
        id_solicitud, tipo_garantia, descripcion, valor_avaluo,
        estado, documento_respaldo_url
      ) VALUES ($1, $2, $3, $4, 'VIGENTE', $5)
      RETURNING id_garantia`,
      [idSolicitud, tipo, descripcion, valor, documento]
    );

    const idGarantia = insertResult.rows[0].id_garantia;
    await registrarAuditoria(client, idUsuario, 'REGISTRAR_GARANTIA', idGarantia);

    const detalleResult = await client.query(
      `${SQL_DETALLE_GARANTIA} WHERE g.id_garantia = $1`,
      [idGarantia]
    );

    await client.query('COMMIT');
    transaccionIniciada = false;
    return res.status(201).json({
      mensaje: 'Garantía registrada correctamente.',
      garantia: detalleResult.rows[0],
    });
  } catch (error) {
    if (client && transaccionIniciada) {
      await client.query('ROLLBACK').catch(() => {});
      transaccionIniciada = false;
    }
    if (error.status) return res.status(error.status).json({ error: error.message });
    if (error.code === '23503') {
      return res.status(400).json({ error: 'La solicitud indicada no existe.' });
    }
    if (error.code === '23514' || error.code === '22P02' || error.code === '22003') {
      return res.status(400).json({ error: 'Los datos de la garantía no cumplen las reglas de la base de datos.' });
    }
    console.error('Error al registrar garantía:', error);
    return res.status(500).json({ error: 'No fue posible registrar la garantía.' });
  } finally {
    if (client) client.release();
  }
};

exports.liberarGarantia = async (req, res) => {
  let client;
  let transaccionIniciada = false;

  try {
    const idUsuario = obtenerIdUsuario(req);
    const idGarantia = Number(req.params.id);
    if (!Number.isInteger(idGarantia) || idGarantia <= 0) {
      throw crearError(400, 'El ID de garantía no es válido.');
    }

    client = await db.getClient();
    await client.query('BEGIN');
    transaccionIniciada = true;

    const result = await client.query(
      `SELECT
         g.id_garantia,
         g.estado AS estado_garantia,
         cr.id_credito,
         cr.estado AS estado_credito,
         cr.saldo_capital
       FROM public.garantia g
       INNER JOIN public.solicitud_credito s ON s.id_solicitud = g.id_solicitud
       LEFT JOIN public.credito cr ON cr.id_solicitud = s.id_solicitud
       WHERE g.id_garantia = $1
       FOR UPDATE OF g`,
      [idGarantia]
    );

    if (result.rowCount === 0) throw crearError(404, 'La garantía no existe.');
    const garantia = result.rows[0];

    if (String(garantia.estado_garantia || '').toUpperCase() !== 'VIGENTE') {
      throw crearError(409, 'La garantía no se encuentra en estado VIGENTE.');
    }
    if (garantia.id_credito == null || garantia.estado_credito !== 'CANCELADO' || Number(garantia.saldo_capital) !== 0) {
      throw crearError(409, 'La garantía solo puede liberarse cuando el crédito esté cancelado y el saldo de capital sea cero.');
    }

    const cuotasPendientes = await client.query(
      `SELECT 1 FROM public.cuota
       WHERE id_credito = $1 AND estado <> 'PAGADA'
       LIMIT 1`,
      [garantia.id_credito]
    );
    if (cuotasPendientes.rowCount > 0) {
      throw crearError(409, 'No se puede liberar la garantía mientras existan cuotas pendientes o vencidas.');
    }

    await client.query(
      `UPDATE public.garantia SET estado = 'LIBERADA' WHERE id_garantia = $1`,
      [idGarantia]
    );
    await registrarAuditoria(client, idUsuario, 'LIBERAR_GARANTIA', idGarantia);

    const detalleResult = await client.query(
      `${SQL_DETALLE_GARANTIA} WHERE g.id_garantia = $1`,
      [idGarantia]
    );

    await client.query('COMMIT');
    transaccionIniciada = false;
    return res.json({ mensaje: 'Garantía liberada correctamente.', garantia: detalleResult.rows[0] });
  } catch (error) {
    if (client && transaccionIniciada) {
      await client.query('ROLLBACK').catch(() => {});
      transaccionIniciada = false;
    }
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('Error al liberar garantía:', error);
    return res.status(500).json({ error: 'No fue posible liberar la garantía.' });
  } finally {
    if (client) client.release();
  }
};
