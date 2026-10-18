const db = require('../../config/db');

const TIPOS_GARANTIA = new Set(['HIPOTECARIA', 'PRENDARIA', 'PERSONAL', 'DPF']);

function errorValidacion(mensaje, status = 400) {
  const error = new Error(mensaje);
  error.status = status;
  return error;
}

exports.registrarSolicitud = async (req, res) => {
  let client;
  let transaccionIniciada = false;

  try {
    const idCliente = Number(req.body.id_cliente);
    const monto = Number(req.body.monto_solicitado);
    const plazo = Number(req.body.plazo_meses);
    const tasa = Number(req.body.tasa_interes_anual);
    const destino = String(req.body.destino_credito || '').trim();
    const tipoGarantia = String(req.body.tipo_garantia || '').trim().toUpperCase();

    if (!Number.isInteger(idCliente) || idCliente <= 0) {
      throw errorValidacion('Debe seleccionar un cliente válido.');
    }
    if (!Number.isFinite(monto) || monto <= 0) {
      throw errorValidacion('El monto solicitado debe ser mayor que cero.');
    }
    if (!Number.isInteger(plazo) || plazo <= 0) {
      throw errorValidacion('El plazo debe ser un número entero de meses mayor que cero.');
    }
    if (!Number.isFinite(tasa) || tasa < 0) {
      throw errorValidacion('La tasa anual debe ser un número válido mayor o igual a cero.');
    }
    if (!destino) {
      throw errorValidacion('El destino del crédito es obligatorio.');
    }
    if (!TIPOS_GARANTIA.has(tipoGarantia)) {
      throw errorValidacion('Seleccione un tipo de garantía válido.');
    }

    client = await db.getClient();
    await client.query('BEGIN');
    transaccionIniciada = true;

    const clienteResult = await client.query(
      'SELECT id_cliente FROM public.cliente WHERE id_cliente = $1 FOR SHARE',
      [idCliente]
    );
    if (clienteResult.rowCount === 0) {
      throw errorValidacion('El cliente seleccionado no existe.', 404);
    }

    const result = await client.query(
      `INSERT INTO public.solicitud_credito (
        id_cliente, monto_solicitado, plazo_meses,
        tasa_interes_anual, destino_credito, tipo_garantia, estado
      ) VALUES ($1, $2, $3, $4, $5, $6, 'REGISTRADA')
      RETURNING *,
        to_char((fecha_solicitud AT TIME ZONE 'UTC') AT TIME ZONE 'America/La_Paz',
                'YYYY-MM-DD HH24:MI:SS') AS fecha_solicitud_local`,
      [idCliente, monto, plazo, tasa, destino, tipoGarantia]
    );

    const solicitud = result.rows[0];
    await client.query('COMMIT');
    transaccionIniciada = false;

    return res.status(201).json({
      mensaje: 'Solicitud registrada correctamente.',
      id_solicitud: solicitud.id_solicitud,
      solicitud,
    });
  } catch (error) {
    if (client && transaccionIniciada) {
      await client.query('ROLLBACK').catch(() => {});
      transaccionIniciada = false;
    }

    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    if (error.code === '23503') {
      return res.status(400).json({ error: 'El cliente indicado no existe o no está disponible.' });
    }
    if (error.code === '23514' || error.code === '22P02' || error.code === '22003') {
      return res.status(400).json({ error: 'Alguno de los datos no cumple las restricciones de la base de datos.' });
    }
    console.error('Error al registrar solicitud:', error);
    return res.status(500).json({ error: 'No fue posible registrar la solicitud.' });
  } finally {
    if (client) client.release();
  }
};

exports.obtenerSolicitudes = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         s.*,
         to_char((s.fecha_solicitud AT TIME ZONE 'UTC') AT TIME ZONE 'America/La_Paz',
                 'YYYY-MM-DD HH24:MI:SS') AS fecha_solicitud_local,
         c.nombres,
         c.apellidos,
         c.ci,
         concat_ws(' ', c.nombres, c.apellidos) AS cliente,
         EXISTS (
           SELECT 1
           FROM public.garantia g
           WHERE g.id_solicitud = s.id_solicitud
         ) AS garantia_vinculada,
         e.resultado AS evaluacion_dictamen
       FROM public.solicitud_credito s
       INNER JOIN public.cliente c ON c.id_cliente = s.id_cliente
       LEFT JOIN public.evaluacion_credito e ON e.id_solicitud = s.id_solicitud
       ORDER BY s.fecha_solicitud DESC NULLS LAST, s.id_solicitud DESC`
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('Error al consultar solicitudes:', error);
    return res.status(500).json({ error: 'No fue posible consultar las solicitudes.' });
  }
};

