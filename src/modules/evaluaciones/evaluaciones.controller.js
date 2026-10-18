const db = require('../../config/db');

const NIVELES_RIESGO = new Set(['BAJO', 'MEDIO', 'ALTO', 'INACEPTABLE']);
const RESULTADOS = new Set(['FAVORABLE', 'DESFAVORABLE']);

function errorOperacion(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function dineroRedondeado(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

exports.evaluarSolicitud = async (req, res) => {
  let client;
  let transaccionIniciada = false;

  try {
    const body = req.body || {};
    const idSolicitud = Number(body.id_solicitud);
    const ingresosRaw = body.ingresos;
    const gastosRaw = body.gastos;
    const ingresos = Number(ingresosRaw);
    const gastos = Number(gastosRaw);
    const nivelRiesgo = String(body.nivel_riesgo || '').trim().toUpperCase();
    const resultado = String(body.resultado || '').trim().toUpperCase();
    const idUsuario = Number(req.usuario?.id_usuario);

    if (!Number.isInteger(idSolicitud) || idSolicitud <= 0) {
      throw errorOperacion(400, 'Debe proporcionar un ID de solicitud válido.');
    }

    if (
      ingresosRaw === undefined || ingresosRaw === null || String(ingresosRaw).trim() === '' ||
      !Number.isFinite(ingresos) || ingresos < 0
    ) {
      throw errorOperacion(400, 'Los ingresos deben ser un importe numérico mayor o igual a cero.');
    }

    if (
      gastosRaw === undefined || gastosRaw === null || String(gastosRaw).trim() === '' ||
      !Number.isFinite(gastos) || gastos < 0
    ) {
      throw errorOperacion(400, 'Los gastos deben ser un importe numérico mayor o igual a cero.');
    }

    if (!NIVELES_RIESGO.has(nivelRiesgo)) {
      throw errorOperacion(400, 'El nivel de riesgo debe ser BAJO, MEDIO, ALTO o INACEPTABLE.');
    }

    if (!RESULTADOS.has(resultado)) {
      throw errorOperacion(400, 'El resultado debe ser FAVORABLE o DESFAVORABLE.');
    }

    if (!Number.isInteger(idUsuario) || idUsuario <= 0) {
      throw errorOperacion(401, 'No se pudo identificar al usuario autenticado. Inicie sesión nuevamente.');
    }

    const ingresosFinal = dineroRedondeado(ingresos);
    const gastosFinal = dineroRedondeado(gastos);
    const capacidadPago = dineroRedondeado(ingresosFinal - gastosFinal);

    // Un resultado favorable no es consistente con capacidad nula/negativa
    // ni con el nivel de riesgo INACEPTABLE.
    if (resultado === 'FAVORABLE' && capacidadPago <= 0) {
      throw errorOperacion(422, 'Una capacidad de pago nula o negativa no puede tener dictamen FAVORABLE.');
    }

    if (resultado === 'FAVORABLE' && nivelRiesgo === 'INACEPTABLE') {
      throw errorOperacion(422, 'Un riesgo INACEPTABLE no puede tener dictamen FAVORABLE.');
    }

    client = await db.getClient();
    await client.query('BEGIN');
    transaccionIniciada = true;

    // Bloquea la solicitud para evitar evaluaciones duplicadas concurrentes.
    const solicitudResult = await client.query(
      `SELECT id_solicitud, estado
       FROM public.solicitud_credito
       WHERE id_solicitud = $1
       FOR UPDATE`,
      [idSolicitud]
    );

    if (solicitudResult.rowCount === 0) {
      throw errorOperacion(404, 'La solicitud indicada no existe.');
    }

    const solicitud = solicitudResult.rows[0];

    if (solicitud.estado !== 'REGISTRADA') {
      throw errorOperacion(
        409,
        `La solicitud no puede evaluarse porque su estado actual es ${solicitud.estado}. Solo se evalúan solicitudes REGISTRADA.`
      );
    }

    const evaluacionExistente = await client.query(
      `SELECT id_evaluacion
       FROM public.evaluacion_credito
       WHERE id_solicitud = $1`,
      [idSolicitud]
    );

    if (evaluacionExistente.rowCount > 0) {
      throw errorOperacion(409, 'La solicitud ya tiene una evaluación registrada. No se creó otra.');
    }

    const evaluacionResult = await client.query(
      `INSERT INTO public.evaluacion_credito (
        id_solicitud,
        fecha_evaluacion,
        ingresos,
        gastos,
        capacidad_pago,
        nivel_riesgo,
        resultado
      ) VALUES ($1, (NOW() AT TIME ZONE 'America/La_Paz')::date, $2, $3, $4, $5, $6)
      RETURNING *`,
      [idSolicitud, ingresosFinal, gastosFinal, capacidadPago, nivelRiesgo, resultado]
    );

    const actualizacion = await client.query(
      `UPDATE public.solicitud_credito
       SET estado = 'EN_EVALUACION'
       WHERE id_solicitud = $1 AND estado = 'REGISTRADA'
       RETURNING id_solicitud, estado`,
      [idSolicitud]
    );

    if (actualizacion.rowCount !== 1) {
      throw errorOperacion(409, 'El estado de la solicitud cambió durante la evaluación. No se guardó la operación.');
    }

    await client.query(
      `INSERT INTO public.auditoria (
        id_usuario, operacion, entidad, id_entidad, resultado
      ) VALUES ($1, 'EVALUAR_SOLICITUD', 'EVALUACION_CREDITO', $2, 'EXITO')`,
      [idUsuario, evaluacionResult.rows[0].id_evaluacion]
    );

    await client.query('COMMIT');
    transaccionIniciada = false;

    return res.status(201).json({
      mensaje: 'Evaluación guardada correctamente.',
      evaluacion: evaluacionResult.rows[0],
      id_solicitud: idSolicitud,
      estado_solicitud: actualizacion.rows[0].estado,
    });
  } catch (error) {
    if (client && transaccionIniciada) {
      await client.query('ROLLBACK').catch(() => {});
      transaccionIniciada = false;
    }

    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }

    if (error.code === '23505') {
      return res.status(409).json({ error: 'La solicitud ya tiene una evaluación registrada.' });
    }

    if (error.code === '23503') {
      return res.status(400).json({ error: 'La referencia de solicitud o usuario no es válida.' });
    }

    if (error.code === '23514' || error.code === '22P02' || error.code === '22003') {
      return res.status(400).json({ error: 'Los datos no cumplen las restricciones de la base de datos.' });
    }

    console.error('Error al guardar evaluación crediticia:', error);
    return res.status(500).json({ error: 'No fue posible guardar la evaluación.' });
  } finally {
    if (client) client.release();
  }
};

