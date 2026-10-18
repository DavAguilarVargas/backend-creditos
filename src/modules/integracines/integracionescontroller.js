const crypto = require('crypto');

// CU03: Simulación académica de consulta de riesgo.
// No consulta Infocred ni ASFI y no debe presentarse como un informe real.
const consultarRiesgoCrediticio = async (req, res) => {
  try {
    const ci = String(req.params.ci || '').trim();
    if (!ci) return res.status(400).json({ error: 'La cédula de identidad (CI) es obligatoria.' });
    const ultimoDigito = Number.parseInt(ci.slice(-1), 10) || 0;
    const score = 750 - ultimoDigito * 25;
    let nivelRiesgo = 'BAJO';
    let dictamenRecomendado = 'FAVORABLE';
    let deudasActuales = 0;
    if (score < 600) {
      nivelRiesgo = 'ALTO';
      dictamenRecomendado = 'DESFAVORABLE';
      deudasActuales = 15000;
    } else if (score < 680) {
      nivelRiesgo = 'MEDIO';
      dictamenRecomendado = 'FAVORABLE_CON_CONDICION';
      deudasActuales = 4500;
    }
    const referenciaExterna = `SIM-RIESGO-${Date.now().toString(36).toUpperCase()}`;
    return res.json({
      exito: true,
      modo: 'SIMULACION',
      aviso: 'SIMULACIÓN ACADÉMICA: esta respuesta no proviene de Infocred, ASFI ni de una central real.',
      proveedor: 'Proveedor de prueba local',
      referencia_consulta: referenciaExterna,
      fecha_consulta: new Date().toISOString(),
      cliente: {
        ci,
        score_crediticio: score,
        nivel_riesgo: nivelRiesgo,
        deudas_sistema_financiero: deudasActuales,
        calificacion_entidades: score > 650 ? 'A - Simulada' : 'C - Simulada',
        dictamen_recomendado: dictamenRecomendado,
      },
    });
  } catch (error) {
    console.error('Error en simulación de riesgo:', error);
    return res.status(500).json({ error: 'No fue posible ejecutar la simulación de riesgo.' });
  }
};

// CU11: API simulada del Core bancario. Nunca inicia transferencias ni mueve dinero.
const procesarDesembolsoCore = async (req, res) => {
  try {
    const idCredito = Number(req.body?.id_credito);
    const monto = Number(req.body?.monto);
    const numeroCuenta = String(req.body?.numero_cuenta || '').trim().slice(0, 100) || 'CUENTA-DEMO-NO-OPERATIVA';
    if (!Number.isInteger(idCredito) || idCredito <= 0 || !Number.isFinite(monto) || monto <= 0) {
      return res.status(400).json({ error: 'Debe proporcionar un crédito y monto válidos para simular el Core.' });
    }
    const suffix = `${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const transaccionCore = `SIM-CORE-${suffix}`;
    return res.json({
      exito: true,
      modo: 'SIMULACION',
      movimiento_real_ejecutado: false,
      mensaje: 'Respuesta simulada del Core recibida. No se ejecutó una transferencia real.',
      codigo_transaccion_core: transaccionCore,
      id_credito: idCredito,
      monto_desembolsado_simulado: Number(monto.toFixed(2)),
      cuenta_destino: numeroCuenta,
      fecha_procesamiento: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error en simulación de Core:', error);
    return res.status(500).json({ error: 'No fue posible ejecutar la simulación del Core bancario.' });
  }
};

module.exports = { consultarRiesgoCrediticio, procesarDesembolsoCore };
