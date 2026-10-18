const crypto = require('crypto');
const db = require('../../config/db');

const METODOS_PERMITIDOS = new Set(['EFECTIVO', 'QR', 'TRANSFERENCIA']);

function errorOperacion(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function obtenerUsuario(req) {
  const idUsuario = Number(req.usuario?.id_usuario);
  if (!Number.isInteger(idUsuario) || idUsuario <= 0) {
    throw errorOperacion(401, 'No se pudo identificar al usuario autenticado. Inicie sesión nuevamente.');
  }
  return {
    id: idUsuario,
    nombre: String(req.usuario?.nombre || req.usuario?.nombre_completo || req.usuario?.login || 'Cajero autorizado'),
  };
}

// Convierte importes decimales con hasta 2 decimales a centavos enteros.
// Evita comparar importes monetarios con aritmética binaria de punto flotante.
function aCentavos(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [entero, decimales = ''] = text.split('.');
  return (BigInt(entero) * 100n) + BigInt(decimales.padEnd(2, '0'));
}

function dineroDesdeCentavos(cents) {
  const negativo = cents < 0n;
  const abs = negativo ? -cents : cents;
  const entero = abs / 100n;
  const decimales = String(abs % 100n).padStart(2, '0');
  return `${negativo ? '-' : ''}${entero}.${decimales}`;
}

function generarNumeroTransaccion() {
  // El componente temporal del recibo usa la hora operativa de Bolivia, no UTC del host.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const fecha = `${fields.year}${fields.month}${fields.day}${fields.hour}${fields.minute}${fields.second}`;
  const sufijo = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `REC-${fecha}-${sufijo}`;
}

async function registrarAuditoria(client, idUsuario, operacion, entidad, idEntidad, resultado) {
  // El esquema histórico puede restringir resultado a VARCHAR(20): usar códigos breves.
  await client.query(
    `INSERT INTO public.auditoria
       (id_usuario, operacion, entidad, id_entidad, resultado)
     VALUES ($1, $2, $3, $4, $5)`,
    [idUsuario, operacion, entidad, idEntidad ?? null, String(resultado || 'EXITO').slice(0, 20)]
  );
}

const SQL_CREDITO = `
  SELECT
    cr.id_credito,
    cr.id_solicitud,
    cr.numero_credito,
    cr.monto_aprobado AS monto_concedido,
    cr.tasa_interes,
    cr.plazo_meses,
    cr.fecha_desembolso,
    cr.saldo_capital AS saldo_pendiente,
    cr.estado,
    s.destino_credito,
    cli.id_cliente,
    cli.ci AS ci_cliente,
    concat_ws(' ', cli.nombres, cli.apellidos) AS nombre_cliente
  FROM public.credito cr
  INNER JOIN public.solicitud_credito s ON s.id_solicitud = cr.id_solicitud
  INNER JOIN public.cliente cli ON cli.id_cliente = s.id_cliente
`;

async function buscarCreditoUnico(identificador) {
  // Priorizar número oficial de crédito o ID interno cuando hay coincidencia exacta.
  const porNumero = await db.query(
    `${SQL_CREDITO}
     WHERE cr.numero_credito = $1 OR cr.id_credito::text = $1
     ORDER BY cr.id_credito DESC
     LIMIT 2`,
    [identificador]
  );
  if (porNumero.rowCount === 1) return { credito: porNumero.rows[0] };
  if (porNumero.rowCount > 1) {
    throw errorOperacion(409, 'La búsqueda coincide con más de un crédito. Utilice el número oficial de crédito.');
  }

  // Una CI puede tener varios créditos. En vez de fallar, devolver una lista
  // mínima para que el cajero seleccione el número correcto.
  const porCi = await db.query(
    `${SQL_CREDITO}
     WHERE cli.ci = $1
     ORDER BY cr.id_credito DESC
     LIMIT 50`,
    [identificador]
  );
  if (porCi.rowCount === 0) {
    throw errorOperacion(404, 'No se encontró un crédito para el número o CI ingresado.');
  }
  if (porCi.rowCount > 1) {
    return {
      requiere_seleccion: true,
      creditos: porCi.rows.map((row) => ({
        id_credito: row.id_credito,
        numero_credito: row.numero_credito,
        monto_concedido: row.monto_concedido,
        saldo_pendiente: row.saldo_pendiente,
        estado: row.estado,
        destino_credito: row.destino_credito,
        id_solicitud: row.id_solicitud,
        nombre_cliente: row.nombre_cliente,
        ci_cliente: row.ci_cliente,
      })),
    };
  }
  return { credito: porCi.rows[0] };
}

async function obtenerCuotasCredito(credito) {
  const cuotasResult = await db.query(
    `SELECT
       q.id_cuota,
       q.id_credito,
       q.numero AS nro_cuota,
       q.fecha_vencimiento,
       q.capital AS monto_capital,
       q.interes AS monto_interes,
       COALESCE(q.monto_penalidad, 0) AS monto_mora,
       q.monto,
       ROUND(q.monto + COALESCE(q.monto_penalidad, 0), 2) AS monto_total,
       q.saldo AS saldo_capital_posterior,
       q.estado,
       COALESCE(p.numero_pagos, 0)::integer AS numero_pagos,
       COALESCE(p.total_pagado, 0)::numeric(12,2) AS total_pagado
     FROM public.cuota q
     LEFT JOIN (
       SELECT id_cuota, COUNT(*) AS numero_pagos, SUM(monto_pagado) AS total_pagado
       FROM public.pago
       GROUP BY id_cuota
     ) p ON p.id_cuota = q.id_cuota
     WHERE q.id_credito = $1
     ORDER BY q.numero`,
    [credito.id_credito]
  );
  return cuotasResult.rows;
}

exports.buscarCreditoParaPago = async (req, res) => {
  try {
    const identificador = String(req.params.identificador || '').trim();
    if (!identificador || identificador.length > 100) {
      return res.status(400).json({ error: 'Ingrese un número de crédito o CI válido.' });
    }

    const resultadoBusqueda = await buscarCreditoUnico(identificador);
    if (resultadoBusqueda.requiere_seleccion) {
      return res.json({
        requiere_seleccion: true,
        creditos: resultadoBusqueda.creditos,
        mensaje: 'La CI corresponde a varios créditos. Seleccione el número de crédito que desea cobrar.',
      });
    }

    const credito = resultadoBusqueda.credito;
    const cuotas = await obtenerCuotasCredito(credito);
    return res.json({ credito, cuotas });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('Error al buscar crédito para pago:', error);
    return res.status(500).json({ error: 'No fue posible consultar el crédito y su cronograma.' });
  }
};

exports.registrarPago = async (req, res) => {
  let client;
  let transaccionIniciada = false;

  try {
    const usuario = obtenerUsuario(req);
    const {
      id_cuota,
      monto_pagado,
      metodo_pago,
      referencia_externa,
      confirmar_recepcion,
    } = req.body || {};

    const idCuota = Number(id_cuota);
    if (!Number.isInteger(idCuota) || idCuota <= 0) {
      throw errorOperacion(400, 'Debe seleccionar una cuota válida.');
    }

    const montoCentavos = aCentavos(monto_pagado);
    if (montoCentavos === null || montoCentavos <= 0n) {
      throw errorOperacion(400, 'El importe debe ser mayor que cero y tener como máximo dos decimales.');
    }

    const metodo = String(metodo_pago || '').trim().toUpperCase();
    if (!METODOS_PERMITIDOS.has(metodo)) {
      throw errorOperacion(400, 'Método de pago no permitido.');
    }

    if (confirmar_recepcion !== true) {
      throw errorOperacion(400, 'Debe confirmar que el pago fue recibido o verificado por el canal correspondiente.');
    }

    const referencia = String(referencia_externa || '').trim();
    if (['QR', 'TRANSFERENCIA'].includes(metodo) && (referencia.length < 4 || referencia.length > 100)) {
      throw errorOperacion(400, 'Para QR o transferencia debe ingresar la referencia real emitida por la entidad financiera.');
    }
    if (referencia.length > 100) {
      throw errorOperacion(400, 'La referencia externa no debe superar 100 caracteres.');
    }

    client = await db.getClient();
    await client.query('BEGIN');
    transaccionIniciada = true;

    const cuotaResult = await client.query(
      `SELECT
         q.*,
         cr.estado AS estado_credito,
         cr.saldo_capital AS saldo_credito,
         cr.numero_credito
       FROM public.cuota q
       INNER JOIN public.credito cr ON cr.id_credito = q.id_credito
       WHERE q.id_cuota = $1
       FOR UPDATE OF q, cr`,
      [idCuota]
    );

    if (cuotaResult.rowCount === 0) {
      throw errorOperacion(404, 'La cuota no existe.');
    }

    const cuota = cuotaResult.rows[0];
    if (!['VIGENTE', 'EN_MORA'].includes(cuota.estado_credito)) {
      throw errorOperacion(409, 'Solo se pueden registrar pagos en créditos VIGENTE o EN_MORA.');
    }
    if (!['PENDIENTE', 'VENCIDA'].includes(cuota.estado)) {
      throw errorOperacion(409, 'La cuota no está pendiente de pago.');
    }

    const pagosPrevios = await client.query(
      'SELECT COUNT(*)::integer AS total FROM public.pago WHERE id_cuota = $1',
      [idCuota]
    );
    if (Number(pagosPrevios.rows[0].total) > 0) {
      throw errorOperacion(409, 'La cuota ya tiene pagos asociados. Requiere conciliación antes de registrar otro movimiento.');
    }

    const capitalCentavos = aCentavos(cuota.capital);
    const saldoCapitalCentavos = aCentavos(cuota.saldo_credito);
    const montoCuotaCentavos = aCentavos(cuota.monto);
    const penalidadCentavos = aCentavos(cuota.monto_penalidad || '0.00');
    if ([capitalCentavos, saldoCapitalCentavos, montoCuotaCentavos, penalidadCentavos].some(v => v === null)) {
      throw errorOperacion(500, 'Los importes almacenados para la cuota no tienen un formato monetario válido.');
    }

    const importeExigible = montoCuotaCentavos + penalidadCentavos;
    if (montoCentavos !== importeExigible) {
      throw errorOperacion(
        400,
        `En esta versión se registra la cuota completa. Importe exigible: Bs. ${dineroDesdeCentavos(importeExigible)}. No se admiten abonos parciales ni pagos excedentes.`
      );
    }

    // El saldo de crédito es capital pendiente. Un pequeño desfase de redondeo de hasta Bs. 0,02
    // se permite únicamente para la última cuota; nunca se permite restar capital de más.
    if (saldoCapitalCentavos + 2n < capitalCentavos) {
      throw errorOperacion(409, 'El capital de la cuota supera el saldo de capital del crédito. Revise el cronograma antes de cobrar.');
    }

    const nroTransaccion = generarNumeroTransaccion();
    const pagoResult = await client.query(
      `INSERT INTO public.pago
         (nro_transaccion, id_cuota, id_usuario_cajero, monto_pagado,
          metodo_pago, referencia_externa, fecha_pago)
       VALUES ($1, $2, $3, $4::numeric, $5, $6, timezone('UTC', NOW()))
       RETURNING id_pago, nro_transaccion, id_cuota, id_usuario_cajero,
                 monto_pagado, metodo_pago, referencia_externa,
                 to_char((fecha_pago AT TIME ZONE 'UTC') AT TIME ZONE 'America/La_Paz',
                         'YYYY-MM-DD HH24:MI:SS') AS fecha_pago_local`,
      [nroTransaccion, idCuota, usuario.id, dineroDesdeCentavos(montoCentavos), metodo, referencia || null]
    );
    const pago = pagoResult.rows[0];

    // IMPORTANTE: cuota.saldo es el saldo de capital posterior según el cronograma,
    // no el importe pendiente de la cuota. Por eso no se cambia a cero al pagar.
    await client.query(
      `UPDATE public.cuota
       SET estado = 'PAGADA'
       WHERE id_cuota = $1`,
      [idCuota]
    );

    const nuevoSaldoCentavos = saldoCapitalCentavos > capitalCentavos
      ? saldoCapitalCentavos - capitalCentavos
      : 0n;
    const nuevoSaldo = dineroDesdeCentavos(nuevoSaldoCentavos);

    const abiertosResult = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE estado IN ('PENDIENTE', 'VENCIDA'))::integer AS cuotas_abiertas,
         COUNT(*) FILTER (
           WHERE estado = 'VENCIDA'
              OR (estado = 'PENDIENTE' AND fecha_vencimiento < (NOW() AT TIME ZONE 'America/La_Paz')::date)
         )::integer AS cuotas_en_mora
       FROM public.cuota
       WHERE id_credito = $1`,
      [cuota.id_credito]
    );

    const cuotasAbiertas = Number(abiertosResult.rows[0].cuotas_abiertas || 0);
    const cuotasEnMora = Number(abiertosResult.rows[0].cuotas_en_mora || 0);
    let nuevoEstadoCredito = 'VIGENTE';
    if (nuevoSaldoCentavos === 0n && cuotasAbiertas === 0) {
      nuevoEstadoCredito = 'CANCELADO';
    } else if (cuotasEnMora > 0) {
      nuevoEstadoCredito = 'EN_MORA';
    }

    await client.query(
      `UPDATE public.credito
       SET saldo_capital = $1::numeric,
           estado = $2
       WHERE id_credito = $3`,
      [nuevoSaldo, nuevoEstadoCredito, cuota.id_credito]
    );

    await registrarAuditoria(
      client,
      usuario.id,
      'REGISTRAR_PAGO',
      'PAGO',
      pago.id_pago,
      metodo === 'EFECTIVO' ? 'PAGO_EFECTIVO_OK' : 'PAGO_EXTERNO_OK'
    );

    await client.query('COMMIT');
    transaccionIniciada = false;

    return res.status(201).json({
      mensaje: 'Pago registrado correctamente.',
      id_pago: pago.id_pago,
      nro_transaccion: pago.nro_transaccion,
      numero_recibo: pago.nro_transaccion,
      monto_pagado: pago.monto_pagado,
      metodo_pago: pago.metodo_pago,
      referencia_externa: pago.referencia_externa,
      // String local renderizable directamente: evita que el navegador vuelva a desplazarla.
      fecha_pago: pago.fecha_pago_local,
      fecha_pago_local: pago.fecha_pago_local,
      nombre_cajero: usuario.nombre,
      credito: {
        id_credito: cuota.id_credito,
        numero_credito: cuota.numero_credito,
        saldo_pendiente: nuevoSaldo,
        estado: nuevoEstadoCredito,
      },
      cuota: {
        id_cuota: cuota.id_cuota,
        nro_cuota: cuota.numero,
        monto_capital: cuota.capital,
        monto_interes: cuota.interes,
        monto_mora: cuota.monto_penalidad,
        monto_total: dineroDesdeCentavos(importeExigible),
        estado: 'PAGADA',
      },
    });
  } catch (error) {
    if (client && transaccionIniciada) {
      await client.query('ROLLBACK').catch(() => {});
    }
    if (error.status) return res.status(error.status).json({ error: error.message });
    if (error.code === '23505') {
      return res.status(409).json({ error: 'La referencia de transacción ya existe. Vuelva a intentar la operación.' });
    }
    if (error.code === '42703' && String(error.message).includes('referencia_externa')) {
      return res.status(500).json({
        error: 'Falta aplicar la migración de pagos que incorpora referencia_externa. Consulte el README de instalación.',
      });
    }
    console.error('Error al registrar pago:', error);
    return res.status(500).json({ error: 'No fue posible registrar el pago. No se confirmó ningún cambio.' });
  } finally {
    if (client) client.release();
  }
};

exports.controlarMora = async (req, res) => {
  let client;
  let transaccionIniciada = false;

  try {
    const usuario = obtenerUsuario(req);
    client = await db.getClient();
    await client.query('BEGIN');
    transaccionIniciada = true;

    // Fecha operativa de Bolivia: una cuota vence al terminar su fecha de vencimiento.
    const cuotasVencidasResult = await client.query(
      `UPDATE public.cuota q
       SET estado = 'VENCIDA'
       FROM public.credito cr
       WHERE cr.id_credito = q.id_credito
         AND cr.estado IN ('VIGENTE', 'EN_MORA')
         AND q.estado = 'PENDIENTE'
         AND q.fecha_vencimiento < (NOW() AT TIME ZONE 'America/La_Paz')::date
       RETURNING q.id_cuota, q.id_credito`,
      []
    );

    const creditosMoraResult = await client.query(
      `UPDATE public.credito cr
       SET estado = 'EN_MORA'
       WHERE cr.estado = 'VIGENTE'
         AND EXISTS (
           SELECT 1
           FROM public.cuota q
           WHERE q.id_credito = cr.id_credito
             AND q.estado = 'VENCIDA'
             AND q.fecha_vencimiento < (NOW() AT TIME ZONE 'America/La_Paz')::date
         )
       RETURNING cr.id_credito`,
      []
    );

    // Si ya no quedan cuotas vencidas/exigibles, reactivar el crédito que tenía EN_MORA.
    const creditosReactivadosResult = await client.query(
      `UPDATE public.credito cr
       SET estado = 'VIGENTE'
       WHERE cr.estado = 'EN_MORA'
         AND cr.saldo_capital > 0
         AND NOT EXISTS (
           SELECT 1
           FROM public.cuota q
           WHERE q.id_credito = cr.id_credito
             AND q.estado IN ('PENDIENTE', 'VENCIDA')
             AND q.fecha_vencimiento < (NOW() AT TIME ZONE 'America/La_Paz')::date
         )
       RETURNING cr.id_credito`,
      []
    );

    for (const cuota of cuotasVencidasResult.rows) {
      await registrarAuditoria(client, usuario.id, 'CUOTA_VENCIDA', 'CUOTA', cuota.id_cuota, 'VENCIDA');
    }
    for (const credito of creditosMoraResult.rows) {
      await registrarAuditoria(client, usuario.id, 'CREDITO_EN_MORA', 'CREDITO', credito.id_credito, 'EN_MORA');
    }
    for (const credito of creditosReactivadosResult.rows) {
      await registrarAuditoria(client, usuario.id, 'CREDITO_SIN_MORA', 'CREDITO', credito.id_credito, 'VIGENTE');
    }

    const cambios = cuotasVencidasResult.rowCount + creditosMoraResult.rowCount + creditosReactivadosResult.rowCount;
    if (cambios === 0) {
      await registrarAuditoria(client, usuario.id, 'CONTROL_MORA', 'SISTEMA', null, 'SIN_CAMBIOS');
    }

    await client.query('COMMIT');
    transaccionIniciada = false;

    return res.json({
      mensaje: 'Control de mora completado.',
      cuotas_marcadas_vencidas: cuotasVencidasResult.rowCount,
      creditos_cambiados_a_mora: creditosMoraResult.rowCount,
      creditos_reactivados: creditosReactivadosResult.rowCount,
      fecha_operativa: 'America/La_Paz',
      politica_penalidad: 'No se recalcularon penalidades; solo se actualizaron estados por vencimiento según CU13.',
    });
  } catch (error) {
    if (client && transaccionIniciada) await client.query('ROLLBACK').catch(() => {});
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('Error al controlar mora:', error);
    return res.status(500).json({ error: 'No fue posible completar el control de mora.' });
  } finally {
    if (client) client.release();
  }
};

exports.reporteResumen = async (_req, res) => {
  try {
    const resumen = await db.query(`
      SELECT
        COUNT(*)::integer AS total_creditos,
        COALESCE(SUM(monto_aprobado), 0)::numeric(14,2) AS monto_total_otorgado,
        COALESCE(SUM(saldo_capital), 0)::numeric(14,2) AS saldo_pendiente
      FROM public.credito
    `);

    const mora = await db.query(`
      SELECT COUNT(*)::integer AS cuotas_vencidas
      FROM public.cuota
      WHERE fecha_vencimiento < (NOW() AT TIME ZONE 'America/La_Paz')::date
        AND estado IN ('PENDIENTE', 'VENCIDA')
    `);

    return res.json({ resumen_cartera: resumen.rows[0], mora: mora.rows[0] });
  } catch (error) {
    console.error('Error al generar resumen de pagos:', error);
    return res.status(500).json({ error: 'No fue posible generar el resumen de cartera y mora.' });
  }
};
