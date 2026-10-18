const db = require('../../config/db');

const ESTADOS_CREDITO = ['APROBADO', 'DESEMBOLSADO', 'VIGENTE', 'EN_MORA', 'CANCELADO'];
const ESTADOS_MORA = ['VIGENTE', 'EN_MORA'];
const METODOS_PAGO = ['EFECTIVO', 'QR', 'TRANSFERENCIA'];

function errorHttp(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseFecha(value, nombre) {
  if (value === undefined || value === null || value === '') return null;
  const texto = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    throw errorHttp(400, `El filtro ${nombre} debe tener formato AAAA-MM-DD.`);
  }
  const fecha = new Date(`${texto}T00:00:00.000Z`);
  if (Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== texto) {
    throw errorHttp(400, `El filtro ${nombre} no es una fecha válida.`);
  }
  return texto;
}

function leerFiltros(req, estadosPermitidos = []) {
  const desde = parseFecha(req.query.desde, 'desde');
  const hasta = parseFecha(req.query.hasta, 'hasta');
  if (desde && hasta && desde > hasta) {
    throw errorHttp(400, 'La fecha inicial no puede ser posterior a la fecha final.');
  }

  const estado = String(req.query.estado || '').trim().toUpperCase();
  if (estado && !estadosPermitidos.includes(estado)) {
    throw errorHttp(400, `El filtro estado debe ser uno de estos valores: ${estadosPermitidos.join(', ')}.`);
  }

  const metodoPago = String(req.query.metodo_pago || '').trim().toUpperCase();
  if (metodoPago && !METODOS_PAGO.includes(metodoPago)) {
    throw errorHttp(400, `El método de pago debe ser uno de estos valores: ${METODOS_PAGO.join(', ')}.`);
  }

  const buscar = String(req.query.buscar || '').trim();
  if (buscar.length > 100) throw errorHttp(400, 'El texto de búsqueda no debe superar los 100 caracteres.');

  return { desde, hasta, estado, metodoPago, buscar };
}

function agregarParametro(params, value) {
  params.push(value);
  return `$${params.length}`;
}

function construirFiltrosCredito(filtros) {
  const { desde, hasta, estado, buscar } = filtros;
  const params = [];
  const where = [];

  if (estado) where.push(`cr.estado = ${agregarParametro(params, estado)}`);
  // Para cartera/créditos, el período se interpreta por fecha de desembolso.
  if (desde) where.push(`cr.fecha_desembolso >= ${agregarParametro(params, desde)}::date`);
  if (hasta) where.push(`cr.fecha_desembolso <= ${agregarParametro(params, hasta)}::date`);
  if (buscar) {
    const p = agregarParametro(params, `%${buscar}%`);
    where.push(`(
      cr.numero_credito ILIKE ${p}
      OR cli.ci ILIKE ${p}
      OR concat_ws(' ', cli.nombres, cli.apellidos) ILIKE ${p}
    )`);
  }

  return { params, sql: where.length ? `WHERE ${where.join(' AND ')}` : '' };
}

function enviarError(res, etiqueta, error, mensajePublico) {
  if (error.status) {
    return res.status(error.status).json({ error: error.message });
  }
  // No se envían sentencias SQL, datos personales ni detalles de conexión al navegador.
  console.error(`[CU14 ${etiqueta}]`, {
    mensaje: error.message,
    codigo: error.code || 'SIN_CODIGO_POSTGRES',
  });
  return res.status(500).json({ error: mensajePublico });
}

async function cartera(req, res) {
  try {
    const filtros = leerFiltros(req, ESTADOS_CREDITO);
    const { params, sql } = construirFiltrosCredito(filtros);

    const resumenResult = await db.query(
      `SELECT
         cr.estado,
         COUNT(*)::integer AS total_creditos,
         COALESCE(SUM(cr.monto_aprobado), 0)::numeric(14,2) AS monto_total_otorgado,
         COALESCE(SUM(cr.saldo_capital), 0)::numeric(14,2) AS saldo_pendiente_total
       FROM public.credito cr
       INNER JOIN public.solicitud_credito s ON s.id_solicitud = cr.id_solicitud
       INNER JOIN public.cliente cli ON cli.id_cliente = s.id_cliente
       ${sql}
       GROUP BY cr.estado
       ORDER BY cr.estado`,
      params
    );

    const creditosResult = await db.query(
      `SELECT
         cr.id_credito,
         cr.numero_credito,
         concat_ws(' ', cli.nombres, cli.apellidos) AS cliente,
         cli.ci,
         cr.estado,
         cr.monto_aprobado,
         cr.saldo_capital,
         cr.fecha_desembolso,
         cr.plazo_meses,
         cr.tasa_interes
       FROM public.credito cr
       INNER JOIN public.solicitud_credito s ON s.id_solicitud = cr.id_solicitud
       INNER JOIN public.cliente cli ON cli.id_cliente = s.id_cliente
       ${sql}
       ORDER BY cr.fecha_desembolso DESC NULLS LAST, cr.id_credito DESC
       LIMIT 1000`,
      params
    );

    return res.json({
      tipo_reporte: 'cartera',
      resumen_cartera: resumenResult.rows,
      creditos: creditosResult.rows,
      total_registros: creditosResult.rows.length,
      limite_aplicado: 1000,
    });
  } catch (error) {
    return enviarError(res, 'cartera', error, 'No fue posible generar el reporte de cartera. Revise los filtros e inténtelo nuevamente.');
  }
}

async function creditos(req, res) {
  try {
    const filtros = leerFiltros(req, ESTADOS_CREDITO);
    const { params, sql } = construirFiltrosCredito(filtros);
    const result = await db.query(
      `SELECT
         cr.id_credito,
         cr.numero_credito,
         concat_ws(' ', cli.nombres, cli.apellidos) AS cliente,
         cli.ci,
         cr.estado,
         cr.monto_aprobado,
         cr.saldo_capital,
         cr.tasa_interes,
         cr.plazo_meses,
         cr.fecha_desembolso,
         s.fecha_solicitud,
         (SELECT COUNT(*)::integer FROM public.cuota q WHERE q.id_credito = cr.id_credito) AS total_cuotas,
         (SELECT COUNT(*)::integer FROM public.cuota q WHERE q.id_credito = cr.id_credito AND q.estado = 'PAGADA') AS cuotas_pagadas,
         (SELECT COUNT(*)::integer FROM public.cuota q WHERE q.id_credito = cr.id_credito AND q.estado IN ('PENDIENTE', 'VENCIDA')) AS cuotas_abiertas
       FROM public.credito cr
       INNER JOIN public.solicitud_credito s ON s.id_solicitud = cr.id_solicitud
       INNER JOIN public.cliente cli ON cli.id_cliente = s.id_cliente
       ${sql}
       ORDER BY cr.id_credito DESC
       LIMIT 1000`,
      params
    );

    return res.json({ tipo_reporte: 'creditos', creditos: result.rows, total_registros: result.rows.length, limite_aplicado: 1000 });
  } catch (error) {
    return enviarError(res, 'creditos', error, 'No fue posible generar el reporte de créditos. Revise los filtros e inténtelo nuevamente.');
  }
}

async function mora(req, res) {
  try {
    const filtros = leerFiltros(req, ESTADOS_MORA);
    const params = [];
    const filtrosCuota = [];
    const filtrosCredito = [];

    // Se usa la fecha operativa de Bolivia; no se cambia ningún estado al consultar el reporte.
    filtrosCuota.push(`q.fecha_vencimiento < (NOW() AT TIME ZONE 'America/La_Paz')::date`);
    filtrosCuota.push(`q.estado IN ('PENDIENTE', 'VENCIDA')`);
    if (filtros.desde) filtrosCuota.push(`q.fecha_vencimiento >= ${agregarParametro(params, filtros.desde)}::date`);
    if (filtros.hasta) filtrosCuota.push(`q.fecha_vencimiento <= ${agregarParametro(params, filtros.hasta)}::date`);
    if (filtros.estado) filtrosCredito.push(`cr.estado = ${agregarParametro(params, filtros.estado)}`);
    if (filtros.buscar) {
      const p = agregarParametro(params, `%${filtros.buscar}%`);
      filtrosCredito.push(`(
        cr.numero_credito ILIKE ${p}
        OR cli.ci ILIKE ${p}
        OR concat_ws(' ', cli.nombres, cli.apellidos) ILIKE ${p}
      )`);
    }

    const whereCredito = filtrosCredito.length ? `AND ${filtrosCredito.join(' AND ')}` : '';
    const result = await db.query(
      `WITH cuotas_en_mora AS (
         SELECT
           q.id_credito,
           COUNT(*)::integer AS cuotas_vencidas,
           MIN(q.fecha_vencimiento) AS fecha_vencimiento_mas_antigua,
           COALESCE(SUM(q.monto), 0)::numeric(14,2) AS monto_vencido
         FROM public.cuota q
         WHERE ${filtrosCuota.join(' AND ')}
         GROUP BY q.id_credito
       )
       SELECT
         cr.id_credito,
         cr.numero_credito,
         concat_ws(' ', cli.nombres, cli.apellidos) AS cliente,
         cli.ci,
         cr.estado AS estado_credito,
         COALESCE(cm.cuotas_vencidas, 0)::integer AS cuotas_vencidas,
         cm.fecha_vencimiento_mas_antigua,
         COALESCE(cm.monto_vencido, 0)::numeric(14,2) AS monto_vencido,
         cr.saldo_capital
       FROM public.credito cr
       INNER JOIN public.solicitud_credito s ON s.id_solicitud = cr.id_solicitud
       INNER JOIN public.cliente cli ON cli.id_cliente = s.id_cliente
       LEFT JOIN cuotas_en_mora cm ON cm.id_credito = cr.id_credito
       WHERE cr.estado IN ('VIGENTE', 'EN_MORA')
         AND (cr.estado = 'EN_MORA' OR COALESCE(cm.cuotas_vencidas, 0) > 0)
       ${whereCredito}
       ORDER BY cm.fecha_vencimiento_mas_antigua ASC NULLS LAST, cr.numero_credito
       LIMIT 1000`,
      params
    );

    const resumen = result.rows.reduce((acc, row) => {
      acc.creditos_en_mora += 1;
      acc.cuotas_vencidas += Number(row.cuotas_vencidas || 0);
      acc.monto_vencido += Number(row.monto_vencido || 0);
      return acc;
    }, { creditos_en_mora: 0, cuotas_vencidas: 0, monto_vencido: 0 });
    resumen.monto_vencido = Number(resumen.monto_vencido.toFixed(2));

    return res.json({
      tipo_reporte: 'mora',
      creditos_en_mora: result.rows,
      resumen_mora: resumen,
      total_registros: result.rows.length,
      limite_aplicado: 1000,
      nota: 'La consulta identifica saldos/cuotas vencidas sin modificar estados. Ejecute CU13 para aplicar cambios pendientes de estado.',
    });
  } catch (error) {
    return enviarError(res, 'mora', error, 'No fue posible generar el reporte de mora. Revise los filtros e inténtelo nuevamente.');
  }
}

async function pagos(req, res) {
  try {
    const filtros = leerFiltros(req, []);
    const params = [];
    const where = [];

    // fecha_pago se almacena como timestamp UTC sin zona; los límites enviados son días de Bolivia.
    if (filtros.desde) {
      const p = agregarParametro(params, filtros.desde);
      where.push(`p.fecha_pago >= ((${p}::date::timestamp AT TIME ZONE 'America/La_Paz') AT TIME ZONE 'UTC')`);
    }
    if (filtros.hasta) {
      const p = agregarParametro(params, filtros.hasta);
      where.push(`p.fecha_pago < (((${p}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'America/La_Paz') AT TIME ZONE 'UTC')`);
    }
    if (filtros.metodoPago) where.push(`p.metodo_pago = ${agregarParametro(params, filtros.metodoPago)}`);
    if (filtros.buscar) {
      const p = agregarParametro(params, `%${filtros.buscar}%`);
      where.push(`(
        p.nro_transaccion ILIKE ${p}
        OR cr.numero_credito ILIKE ${p}
        OR cli.ci ILIKE ${p}
        OR concat_ws(' ', cli.nombres, cli.apellidos) ILIKE ${p}
      )`);
    }
    const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const result = await db.query(
      `SELECT
         p.id_pago,
         p.nro_transaccion,
         to_char((p.fecha_pago AT TIME ZONE 'UTC') AT TIME ZONE 'America/La_Paz', 'YYYY-MM-DD HH24:MI:SS') AS fecha_pago_local,
         p.monto_pagado,
         p.metodo_pago,
         p.referencia_externa,
         cr.numero_credito,
         concat_ws(' ', cli.nombres, cli.apellidos) AS cliente,
         cli.ci,
         q.numero AS numero_cuota
       FROM public.pago p
       INNER JOIN public.cuota q ON q.id_cuota = p.id_cuota
       INNER JOIN public.credito cr ON cr.id_credito = q.id_credito
       INNER JOIN public.solicitud_credito s ON s.id_solicitud = cr.id_solicitud
       INNER JOIN public.cliente cli ON cli.id_cliente = s.id_cliente
       ${sqlWhere}
       ORDER BY p.fecha_pago DESC, p.id_pago DESC
       LIMIT 1000`,
      params
    );

    const resumenResult = await db.query(
      `SELECT
         COUNT(*)::integer AS total_pagos,
         COALESCE(SUM(p.monto_pagado), 0)::numeric(14,2) AS monto_total_pagado
       FROM public.pago p
       INNER JOIN public.cuota q ON q.id_cuota = p.id_cuota
       INNER JOIN public.credito cr ON cr.id_credito = q.id_credito
       INNER JOIN public.solicitud_credito s ON s.id_solicitud = cr.id_solicitud
       INNER JOIN public.cliente cli ON cli.id_cliente = s.id_cliente
       ${sqlWhere}`,
      params
    );

    return res.json({
      tipo_reporte: 'pagos',
      pagos: result.rows,
      resumen_pagos: resumenResult.rows[0],
      total_registros: result.rows.length,
      limite_aplicado: 1000,
    });
  } catch (error) {
    return enviarError(res, 'pagos', error, 'No fue posible generar el reporte de pagos. Revise los filtros e inténtelo nuevamente.');
  }
}

module.exports = { cartera, creditos, mora, pagos };
