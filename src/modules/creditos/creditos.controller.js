const db = require('../../config/db');
const { generarCronogramaFrances } = require('../../utils/amortizacion');

function errorOperacion(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function usuarioAutenticado(req) {
  const idUsuario = Number(req.usuario?.id_usuario);
  if (!Number.isInteger(idUsuario) || idUsuario <= 0) {
    throw errorOperacion(401, 'No se pudo identificar al usuario autenticado. Inicie sesión nuevamente.');
  }
  return { idUsuario, rol: String(req.usuario?.rol || '').toUpperCase() };
}

function fechaISOValida(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00.000Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}

async function auditar(client, idUsuario, operacion, entidad, idEntidad, resultado = 'EXITO') {
  await client.query(
    `INSERT INTO public.auditoria
      (id_usuario, operacion, entidad, id_entidad, resultado)
     VALUES ($1, $2, $3, $4, $5)`,
    [idUsuario, operacion, entidad, idEntidad, String(resultado || 'EXITO').slice(0, 20)]
  );
}

async function obtenerExpediente(client, idCredito) {
  const creditoResult = await client.query(
    `SELECT
       cr.id_credito,
       cr.id_solicitud,
       cr.numero_credito,
       cr.monto_aprobado,
       cr.tasa_interes,
       cr.plazo_meses,
       cr.fecha_desembolso,
       (SELECT to_char(((a.fecha_hora AT TIME ZONE 'UTC') AT TIME ZONE 'America/La_Paz')::date, 'YYYY-MM-DD')
        FROM public.auditoria a
        WHERE a.operacion = 'APROBAR_SOLICITUD'
          AND a.entidad = 'CREDITO'
          AND a.id_entidad = cr.id_credito
        ORDER BY a.fecha_hora ASC, a.id_auditoria ASC
        LIMIT 1) AS fecha_aprobacion,
       cr.saldo_capital,
       cr.estado AS estado_credito,
       s.destino_credito,
       s.tipo_garantia AS tipo_garantia_propuesta,
       s.fecha_solicitud,
       to_char((s.fecha_solicitud AT TIME ZONE 'UTC') AT TIME ZONE 'America/La_Paz',
               'YYYY-MM-DD HH24:MI:SS') AS fecha_solicitud_local,
       cli.id_cliente,
       cli.nombres,
       cli.apellidos,
       cli.ci,
       cli.expedido,
       cli.fecha_nacimiento,
       cli.estado_civil,
       cli.profesion_ocupacion,
       cli.direccion_domicilio,
       cli.telefono_contacto,
       cli.correo,
       e.ingresos,
       e.gastos,
       e.capacidad_pago,
       e.nivel_riesgo,
       e.resultado AS resultado_evaluacion,
       ct.id_contrato,
       ct.numero_contrato,
       ct.fecha_firma,
       ct.estado AS estado_contrato
     FROM public.credito cr
     INNER JOIN public.solicitud_credito s ON s.id_solicitud = cr.id_solicitud
     INNER JOIN public.cliente cli ON cli.id_cliente = s.id_cliente
     LEFT JOIN public.evaluacion_credito e ON e.id_solicitud = s.id_solicitud
     LEFT JOIN public.contrato ct ON ct.id_credito = cr.id_credito
     WHERE cr.id_credito = $1`,
    [idCredito]
  );

  if (creditoResult.rowCount === 0) return null;

  const cuotasResult = await client.query(
    `SELECT id_cuota, id_credito, numero, fecha_vencimiento,
            capital, interes, monto, saldo, monto_penalidad, estado
     FROM public.cuota
     WHERE id_credito = $1
     ORDER BY numero`,
    [idCredito]
  );

  const garantiasResult = await client.query(
    `SELECT id_garantia, id_solicitud, tipo_garantia, descripcion,
            valor_avaluo, estado, documento_respaldo_url
     FROM public.garantia
     WHERE id_solicitud = $1
     ORDER BY id_garantia`,
    [creditoResult.rows[0].id_solicitud]
  );

  const institucionResult = await client.query(
    `SELECT id, razon_social, nit, direccion, telefono, moneda_base,
            tasa_interes_penal_diaria, url_logo, color_primario,
            color_secundario, color_acento, correo_contacto, sitio_web,
            domicilio_legal, representante_legal, documento_representante,
            cargo_representante, referencia_facultades
     FROM public.configuracion_institucion
     ORDER BY id DESC
     LIMIT 1`
  );

  return {
    credito: creditoResult.rows[0],
    contrato: {
      id_contrato: creditoResult.rows[0].id_contrato,
      numero_contrato: creditoResult.rows[0].numero_contrato,
      fecha_firma: creditoResult.rows[0].fecha_firma,
      estado: creditoResult.rows[0].estado_contrato,
    },
    cuotas: cuotasResult.rows,
    garantias: garantiasResult.rows,
    institucion: institucionResult.rows[0] || null,
  };
}

// Consulta operativa para CU11. El historial completo se consulta en /api/auditoria.
exports.listarDesembolsos = async (req, res) => {
  try {
    const creditosResult = await db.query(
      `SELECT
         cr.id_credito,
         cr.id_solicitud,
         cr.numero_credito,
         cr.monto_aprobado,
         cr.tasa_interes,
         cr.plazo_meses,
         to_char(cr.fecha_desembolso, 'YYYY-MM-DD') AS fecha_desembolso,
         cr.saldo_capital,
         cr.estado AS estado_credito,
         s.estado AS estado_solicitud,
         s.destino_credito,
         s.tipo_garantia AS tipo_garantia_propuesta,
         cli.nombres,
         cli.apellidos,
         concat_ws(' ', cli.nombres, cli.apellidos) AS cliente,
         cli.ci,
         ct.id_contrato,
         ct.numero_contrato,
         to_char(ct.fecha_firma, 'YYYY-MM-DD') AS fecha_firma,
         COALESCE(ct.estado, 'SIN_CONTRATO') AS estado_contrato,
         (SELECT COUNT(*)::integer FROM public.cuota q
          WHERE q.id_credito = cr.id_credito) AS cantidad_cuotas,
         (SELECT d.numero_operacion FROM public.desembolso d
          WHERE d.id_credito = cr.id_credito
          ORDER BY d.fecha_registro DESC, d.id_desembolso DESC
          LIMIT 1) AS resultado_desembolso,
         (SELECT d.modo FROM public.desembolso d
          WHERE d.id_credito = cr.id_credito
          ORDER BY d.fecha_registro DESC, d.id_desembolso DESC
          LIMIT 1) AS modo_desembolso,
         (SELECT to_char(d.fecha_registro, 'YYYY-MM-DD HH24:MI:SS')
          FROM public.desembolso d
          WHERE d.id_credito = cr.id_credito
          ORDER BY d.fecha_registro DESC, d.id_desembolso DESC
          LIMIT 1) AS fecha_registro_desembolso
       FROM public.credito cr
       INNER JOIN public.solicitud_credito s ON s.id_solicitud = cr.id_solicitud
       INNER JOIN public.cliente cli ON cli.id_cliente = s.id_cliente
       LEFT JOIN public.contrato ct ON ct.id_credito = cr.id_credito
       WHERE cr.estado IN ('APROBADO', 'DESEMBOLSADO', 'VIGENTE', 'EN_MORA', 'CANCELADO')
       ORDER BY CASE WHEN cr.estado = 'APROBADO' THEN 0 ELSE 1 END,
                cr.id_credito DESC`
    );

    return res.json({ creditos: creditosResult.rows });
  } catch (error) {
    console.error('Error al consultar créditos para desembolso:', error);
    return res.status(500).json({
      error: 'No fue posible consultar el listado de desembolsos.'
    });
  }
};

// CU07 + CU09 + CU10: decisión, registro del crédito, contrato pendiente de firma y cronograma.
exports.aprobarORechazar = async (req, res) => {
  let client;
  let transaccionIniciada = false;

  try {
    const idSolicitud = Number(req.body?.id_solicitud);
    const decision = String(req.body?.decision || '').trim().toUpperCase();
    const motivo = String(req.body?.motivo || req.body?.motivo_rechazo || '').trim();
    const { idUsuario, rol } = usuarioAutenticado(req);

    if (!Number.isInteger(idSolicitud) || idSolicitud <= 0) {
      throw errorOperacion(400, 'Debe proporcionar un ID de solicitud válido.');
    }
    if (!['APROBAR', 'RECHAZAR'].includes(decision)) {
      throw errorOperacion(400, 'La decisión debe ser APROBAR o RECHAZAR.');
    }
    if (decision === 'RECHAZAR' && !motivo) {
      throw errorOperacion(400, 'El motivo es obligatorio para rechazar la solicitud.');
    }

    client = await db.getClient();
    await client.query('BEGIN');
    transaccionIniciada = true;

    const solicitudResult = await client.query(
      `SELECT
         s.*,
         e.id_evaluacion,
         e.resultado AS resultado_evaluacion,
         e.capacidad_pago,
         e.nivel_riesgo
       FROM public.solicitud_credito s
       LEFT JOIN public.evaluacion_credito e ON e.id_solicitud = s.id_solicitud
       WHERE s.id_solicitud = $1
       FOR UPDATE OF s`,
      [idSolicitud]
    );

    if (solicitudResult.rowCount === 0) {
      throw errorOperacion(404, 'La solicitud no existe.');
    }

    const solicitud = solicitudResult.rows[0];
    if (solicitud.estado !== 'EN_EVALUACION') {
      throw errorOperacion(409, `La solicitud no está disponible para decisión. Estado actual: ${solicitud.estado}.`);
    }
    if (!solicitud.id_evaluacion || !solicitud.resultado_evaluacion) {
      throw errorOperacion(409, 'No se puede decidir una solicitud sin evaluación registrada.');
    }

    if (decision === 'RECHAZAR') {
      const updated = await client.query(
        `UPDATE public.solicitud_credito
         SET estado = 'RECHAZADA', motivo_rechazo = $2
         WHERE id_solicitud = $1 AND estado = 'EN_EVALUACION'
         RETURNING id_solicitud, estado`,
        [idSolicitud, motivo]
      );
      if (updated.rowCount !== 1) {
        throw errorOperacion(409, 'La solicitud cambió de estado. No se registró el rechazo.');
      }

      await auditar(client, idUsuario, 'RECHAZAR_SOLICITUD', 'SOLICITUD_CREDITO', idSolicitud, 'RECHAZADO');
      await client.query('COMMIT');
      transaccionIniciada = false;

      return res.json({
        mensaje: 'Solicitud rechazada correctamente.',
        id_solicitud: idSolicitud,
        estado: 'RECHAZADA',
        motivo,
      });
    }

    // RN03: no aprobar si la evaluación no es favorable.
    if (solicitud.resultado_evaluacion !== 'FAVORABLE') {
      throw errorOperacion(409, 'No se puede aprobar una solicitud con evaluación DESFAVORABLE.');
    }

    // RN04: el límite se controla en backend. ADMIN puede operar por encima;
    // el límite de JEFE puede configurarse en Render con LIMITE_APROBACION_JEFE_BOB.
    const limiteConfigurado = Number(process.env.LIMITE_APROBACION_JEFE_BOB || 500000);
    const limiteJefe = Number.isFinite(limiteConfigurado) && limiteConfigurado > 0
      ? limiteConfigurado
      : 500000;
    if (rol === 'JEFE' && Number(solicitud.monto_solicitado) > limiteJefe) {
      throw errorOperacion(403, `El monto supera la atribución de aprobación de Bs. ${limiteJefe.toLocaleString('es-BO')}. Debe escalarse al nivel correspondiente.`);
    }

    // La tasa aprobada es la registrada en la solicitud; no se acepta una tasa
    // distinta enviada por el navegador durante la decisión.
    const tasaFinal = Number(solicitud.tasa_interes_anual);
    if (!Number.isFinite(tasaFinal) || tasaFinal < 0) {
      throw errorOperacion(400, 'La tasa de interés debe ser un número válido mayor o igual a cero.');
    }

    const fechaActualResult = await client.query(
      `SELECT to_char((NOW() AT TIME ZONE 'America/La_Paz')::date, 'YYYY-MM-DD') AS fecha_actual`
    );
    const fechaActual = fechaActualResult.rows[0].fecha_actual;
    const fechaBase = req.body?.fecha_base_cronograma
      ? String(req.body.fecha_base_cronograma)
      : fechaActual;

    if (!fechaISOValida(fechaBase)) {
      throw errorOperacion(400, 'La fecha base del cronograma debe ser una fecha válida con formato YYYY-MM-DD.');
    }
    if (fechaBase < fechaActual) {
      throw errorOperacion(400, 'La fecha base del cronograma no puede ser anterior a la fecha actual.');
    }

    const creditoExistente = await client.query(
      'SELECT id_credito FROM public.credito WHERE id_solicitud = $1',
      [idSolicitud]
    );
    if (creditoExistente.rowCount > 0) {
      throw errorOperacion(409, 'La solicitud ya tiene un crédito asociado. No se creó otro.');
    }

    const anioContrato = fechaActual.slice(0, 4);
    const numeroCredito = `CR-${anioContrato}-${String(idSolicitud).padStart(6, '0')}`;

    const creditoResult = await client.query(
      `INSERT INTO public.credito (
         id_solicitud, numero_credito, monto_aprobado,
         tasa_interes, plazo_meses, saldo_capital, estado
       ) VALUES ($1, $2, $3, $4, $5, $3, 'APROBADO')
       RETURNING *`,
      [idSolicitud, numeroCredito, solicitud.monto_solicitado, tasaFinal, solicitud.plazo_meses]
    );
    const credito = creditoResult.rows[0];

    // CU09: crea el registro contractual, pero no afirma que ya esté firmado.
    const numeroContrato = `CT-${anioContrato}-${String(credito.id_credito).padStart(6, '0')}`;
    const contratoResult = await client.query(
      `INSERT INTO public.contrato (
         id_credito, numero_contrato, fecha_firma, estado
       ) VALUES ($1, $2, NULL, 'PENDIENTE_FIRMA')
       RETURNING *`,
      [credito.id_credito, numeroContrato]
    );
    const contrato = contratoResult.rows[0];

    // CU10: genera el cronograma con fecha base explícita y persiste cada cuota.
    const cronograma = generarCronogramaFrances(
      Number(credito.monto_aprobado),
      Number(credito.tasa_interes),
      Number(credito.plazo_meses),
      fechaBase
    );

    for (const cuota of cronograma) {
      await client.query(
        `INSERT INTO public.cuota (
           id_credito, numero, fecha_vencimiento,
           capital, interes, monto, saldo, estado
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDIENTE')`,
        [
          credito.id_credito,
          cuota.numero_cuota,
          cuota.fecha_vencimiento,
          cuota.monto_capital,
          cuota.monto_interes,
          cuota.monto_total,
          cuota.saldo_restante,
        ]
      );
    }

    const solicitudActualizada = await client.query(
      `UPDATE public.solicitud_credito
       SET estado = 'APROBADA'
       WHERE id_solicitud = $1 AND estado = 'EN_EVALUACION'
       RETURNING id_solicitud, estado`,
      [idSolicitud]
    );
    if (solicitudActualizada.rowCount !== 1) {
      throw errorOperacion(409, 'El estado de la solicitud cambió durante la aprobación. Se revirtió la operación.');
    }

    await auditar(client, idUsuario, 'APROBAR_SOLICITUD', 'CREDITO', credito.id_credito, 'EXITO');
    await auditar(client, idUsuario, 'GENERAR_CONTRATO', 'CONTRATO', contrato.id_contrato, 'PENDIENTE_FIRMA');
    await auditar(client, idUsuario, 'GENERAR_CRONOGRAMA', 'CREDITO', credito.id_credito, 'GENERADO');

    const expediente = await obtenerExpediente(client, credito.id_credito);
    await client.query('COMMIT');
    transaccionIniciada = false;

    return res.status(201).json({
      mensaje: 'Crédito aprobado. Se generó el contrato pendiente de firma y el cronograma de amortización.',
      fecha_base_cronograma: fechaBase,
      solicitud: { id_solicitud: idSolicitud, estado: solicitudActualizada.rows[0].estado },
      ...expediente,
    });
  } catch (error) {
    if (client && transaccionIniciada) {
      await client.query('ROLLBACK').catch(() => {});
      transaccionIniciada = false;
    }

    if (error.status) return res.status(error.status).json({ error: error.message });
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Existe un crédito, contrato o cuota duplicada. La transacción fue revertida.' });
    }
    if (error.code === '23503') {
      return res.status(400).json({ error: 'La operación hace referencia a un registro que no existe.' });
    }
    if (error.code === '23514' || error.code === '22P02' || error.code === '22003') {
      return res.status(400).json({ error: 'Los datos calculados no cumplen las restricciones de la base de datos.' });
    }

    console.error('Error en aprobación/formalización:', error);
    return res.status(500).json({ error: error.message || 'No fue posible aprobar y formalizar el crédito.' });
  } finally {
    if (client) client.release();
  }
};

// CU11: registra una respuesta del Core en modo SIMULACION o una operación REAL ya confirmada.
// SIMULACION nunca acredita que se haya movido dinero; REAL exige confirmación externa explícita.
exports.desembolsarCredito = async (req, res) => {
  let client;
  let transaccionIniciada = false;

  try {
    const idCredito = Number(req.body?.id_credito);
    const { idUsuario } = usuarioAutenticado(req);
    const referencia = String(req.body?.referencia_externa || '').trim().replace(/[\r\n\t]/g, ' ');
    const medio = String(req.body?.medio_desembolso || '').trim().toUpperCase();
    const modo = String(req.body?.modo_desembolso || '').trim().toUpperCase();
    const cuentaDestino = String(req.body?.numero_cuenta || '').trim().slice(0, 100) || null;

    if (!Number.isInteger(idCredito) || idCredito <= 0) {
      throw errorOperacion(400, 'Debe proporcionar un ID de crédito válido.');
    }
    if (!['SIMULACION', 'REAL'].includes(modo)) {
      throw errorOperacion(400, 'El modo de desembolso debe ser SIMULACION o REAL.');
    }
    if (referencia.length < 4 || referencia.length > 120) {
      throw errorOperacion(400, 'Debe proporcionar una referencia de operación válida.');
    }
    const mediosPermitidos = new Set(['TRANSFERENCIA', 'ABONO_CUENTA', 'CHEQUE', 'EFECTIVO', 'OTRO']);
    if (!mediosPermitidos.has(medio)) {
      throw errorOperacion(400, 'El medio de desembolso no es válido.');
    }
    if (modo === 'REAL' && req.body?.confirmacion_externa !== true) {
      throw errorOperacion(400, 'Para una operación real debe confirmar que el movimiento se ejecutó y verificó en el canal financiero autorizado.');
    }
    if (modo === 'SIMULACION') {
      if (req.body?.confirmacion_simulacion !== true) {
        throw errorOperacion(400, 'Debe confirmar que está registrando una simulación sin movimiento monetario real.');
      }
      if (!referencia.startsWith('SIM-CORE-')) {
        throw errorOperacion(400, 'La referencia de simulación debe proceder de la API simulada del Core.');
      }
    }

    client = await db.getClient();
    await client.query('BEGIN');
    transaccionIniciada = true;

    const creditoResult = await client.query(
      `SELECT id_credito, numero_credito, monto_aprobado, plazo_meses, estado
       FROM public.credito
       WHERE id_credito = $1
       FOR UPDATE`,
      [idCredito]
    );
    if (creditoResult.rowCount === 0) throw errorOperacion(404, 'El crédito no existe.');
    const credito = creditoResult.rows[0];

    const tieneDesembolsoReal = await client.query(
      `SELECT 1 FROM public.desembolso
       WHERE id_credito = $1 AND modo = 'REAL' AND estado = 'CONFIRMADO'
       LIMIT 1`,
      [idCredito]
    );
    if (tieneDesembolsoReal.rowCount > 0) {
      throw errorOperacion(409, 'El crédito ya tiene un desembolso real confirmado.');
    }

    if (modo === 'SIMULACION' && credito.estado !== 'APROBADO') {
      throw errorOperacion(409, `Solo se puede simular el desembolso de un crédito APROBADO. Estado actual: ${credito.estado}.`);
    }
    if (modo === 'REAL' && !['APROBADO', 'DESEMBOLSADO'].includes(credito.estado)) {
      throw errorOperacion(409, `El crédito no está listo para desembolso real. Estado actual: ${credito.estado}.`);
    }

    const contratoResult = await client.query(
      `SELECT id_contrato, estado
       FROM public.contrato
       WHERE id_credito = $1
       FOR UPDATE`,
      [idCredito]
    );
    if (contratoResult.rowCount === 0) {
      throw errorOperacion(409, 'No se puede desembolsar: el contrato aún no ha sido generado.');
    }
    if (contratoResult.rows[0].estado !== 'FIRMADO') {
      throw errorOperacion(409, 'No se puede desembolsar: la firma física del contrato aún no ha sido verificada.');
    }

    const cuotasResult = await client.query(
      `SELECT COUNT(*)::integer AS cantidad,
              COUNT(*) FILTER (WHERE capital < 0 OR interes < 0 OR monto < 0 OR saldo < 0)::integer AS invalidas
       FROM public.cuota
       WHERE id_credito = $1`,
      [idCredito]
    );
    const cantidadCuotas = Number(cuotasResult.rows[0].cantidad);
    if (cantidadCuotas !== Number(credito.plazo_meses)) {
      throw errorOperacion(409, `El cronograma contiene ${cantidadCuotas} cuotas; se requieren ${credito.plazo_meses}.`);
    }
    if (Number(cuotasResult.rows[0].invalidas) !== 0) {
      throw errorOperacion(409, 'El cronograma contiene importes inválidos.');
    }

    const estadoDesembolso = modo === 'SIMULACION' ? 'SIMULADO' : 'CONFIRMADO';
    await client.query(
      `INSERT INTO public.desembolso (
         id_credito, numero_operacion, modo, medio_desembolso,
         monto, estado, cuenta_destino, id_usuario, respuesta_core
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        idCredito,
        referencia,
        modo,
        medio,
        credito.monto_aprobado,
        estadoDesembolso,
        cuentaDestino,
        idUsuario,
        JSON.stringify(modo === 'SIMULACION'
          ? { simulated: true, no_monetary_movement: true }
          : { simulated: false, external_confirmation: true })
      ]
    );

    let fechaDesembolso = null;
    let estadoCredito = 'DESEMBOLSADO';
    if (modo === 'REAL') {
      const actualizado = await client.query(
        `UPDATE public.credito
         SET estado = 'VIGENTE', fecha_desembolso = (NOW() AT TIME ZONE 'America/La_Paz')::date
         WHERE id_credito = $1 AND estado IN ('APROBADO', 'DESEMBOLSADO')
         RETURNING to_char(fecha_desembolso, 'YYYY-MM-DD') AS fecha_desembolso`,
        [idCredito]
      );
      if (actualizado.rowCount !== 1) {
        throw errorOperacion(409, 'El crédito cambió de estado. No se registró el desembolso real.');
      }
      fechaDesembolso = actualizado.rows[0].fecha_desembolso;
      estadoCredito = 'VIGENTE';
    } else {
      const actualizado = await client.query(
        `UPDATE public.credito SET estado = 'DESEMBOLSADO'
         WHERE id_credito = $1 AND estado = 'APROBADO'`,
        [idCredito]
      );
      if (actualizado.rowCount !== 1) {
        throw errorOperacion(409, 'El crédito cambió de estado. No se registró la simulación.');
      }
    }

    // resultado es breve porque la columna puede ser VARCHAR(20).
    await auditar(
      client,
      idUsuario,
      'DESEMBOLSAR_CREDITO',
      'CREDITO',
      idCredito,
      modo === 'SIMULACION' ? 'SIMULACION' : 'EXITO'
    );

    await client.query('COMMIT');
    transaccionIniciada = false;
    return res.json({
      mensaje: modo === 'SIMULACION'
        ? 'Simulación registrada. No se ejecutó ninguna transferencia real.'
        : 'El desembolso real confirmado fue registrado. Conserve el comprobante del canal financiero.',
      id_credito: idCredito,
      numero_credito: credito.numero_credito,
      estado: estadoCredito,
      modo_desembolso: modo,
      referencia_externa: referencia,
      medio_desembolso: medio,
      fecha_desembolso: fechaDesembolso,
      tipo_constancia: modo === 'SIMULACION'
        ? 'SIMULACION_SIN_MOVIMIENTO_MONETARIO'
        : 'REGISTRO_INTERNO_DE_OPERACION_REAL',
    });
  } catch (error) {
    if (client && transaccionIniciada) {
      await client.query('ROLLBACK').catch(() => {});
      transaccionIniciada = false;
    }
    if (error.status) return res.status(error.status).json({ error: error.message });
    if (error.code === '23505') {
      return res.status(409).json({ error: 'La referencia de operación ya fue registrada.' });
    }
    console.error('Error al registrar desembolso:', error);
    return res.status(500).json({ error: 'No fue posible registrar el desembolso.' });
  } finally {
    if (client) client.release();
  }
};

// Operación de back-office: el usuario autorizado atestigua que verificó la firma física.
// No representa firma electrónica ni sustituye el resguardo del documento firmado.
exports.confirmarFirmaContrato = async (req, res) => {
  let client;
  let transaccionIniciada = false;

  try {
    const idCredito = Number(req.params.id);
    const { idUsuario } = usuarioAutenticado(req);
    if (!Number.isInteger(idCredito) || idCredito <= 0) {
      throw errorOperacion(400, 'El ID de crédito no es válido.');
    }
    if (req.body?.firma_verificada !== true || req.body?.documento_resguardado !== true) {
      throw errorOperacion(400, 'Debe confirmar que verificó la firma física y que el documento firmado quedó resguardado en el expediente.');
    }

    client = await db.getClient();
    await client.query('BEGIN');
    transaccionIniciada = true;

    const creditoResult = await client.query(
      `SELECT id_credito, estado FROM public.credito WHERE id_credito = $1 FOR UPDATE`,
      [idCredito]
    );
    if (creditoResult.rowCount === 0) throw errorOperacion(404, 'El crédito no existe.');
    if (creditoResult.rows[0].estado !== 'APROBADO') {
      throw errorOperacion(409, 'La firma del contrato solo se registra para créditos aprobados y aún no desembolsados.');
    }

    const contratoResult = await client.query(
      `SELECT id_contrato, estado FROM public.contrato WHERE id_credito = $1 FOR UPDATE`,
      [idCredito]
    );
    if (contratoResult.rowCount === 0) throw errorOperacion(404, 'No existe contrato para este crédito.');
    if (contratoResult.rows[0].estado !== 'PENDIENTE_FIRMA') {
      throw errorOperacion(409, `El contrato no está pendiente de firma. Estado actual: ${contratoResult.rows[0].estado}.`);
    }

    await client.query(
      `UPDATE public.contrato
       SET estado = 'FIRMADO', fecha_firma = (NOW() AT TIME ZONE 'America/La_Paz')::date
       WHERE id_contrato = $1`,
      [contratoResult.rows[0].id_contrato]
    );
    await auditar(
      client,
      idUsuario,
      'FIRMA_CONTRATO_OK',
      'CONTRATO',
      contratoResult.rows[0].id_contrato,
      'VERIFICADO'
    );

    await client.query('COMMIT');
    transaccionIniciada = false;
    return res.json({
      mensaje: 'Se registró la verificación de firma física. Resguarde el documento firmado en el expediente.',
      id_credito: idCredito,
      estado_contrato: 'FIRMADO',
    });
  } catch (error) {
    if (client && transaccionIniciada) {
      await client.query('ROLLBACK').catch(() => {});
      transaccionIniciada = false;
    }
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('Error al confirmar firma de contrato:', error);
    return res.status(500).json({ error: 'No fue posible actualizar el estado del contrato.' });
  } finally {
    if (client) client.release();
  }
};

exports.obtenerCreditoConCuotas = async (req, res) => {
  const idCredito = Number(req.params.id);
  if (!Number.isInteger(idCredito) || idCredito <= 0) {
    return res.status(400).json({ error: 'El ID de crédito no es válido.' });
  }

  try {
    const expediente = await obtenerExpediente(db, idCredito);
    if (!expediente) return res.status(404).json({ error: 'Crédito no encontrado.' });
    return res.json(expediente);
  } catch (error) {
    console.error('Error al obtener expediente de crédito:', error);
    return res.status(500).json({ error: 'No fue posible obtener el expediente del crédito.' });
  }
};

