// ============================================================================
// MÓDULO DE INTEGRACIONES EXTERNAS (CU03 - Riesgo / CU11 - Core Bancario)
// ============================================================================

// CU03: Consultar Historial Crediticio en el Sistema de Riesgo Crediticio
const consultarRiesgoCrediticio = async (req, res) => {
  try {
    const { ci } = req.params;

    if (!ci) {
      return res.status(400).json({ error: 'La Cédula de Identidad (CI) es obligatoria' });
    }

    // Algoritmo determinista de simulación de Central de Riesgo Externa
    // Genera resultados consistentes basados en el último dígito del CI
    const ultimoDigito = parseInt(ci.slice(-1)) || 0;
    
    // Cálculo simulado de Score y Clasificación de Riesgo
    let score = 750 - (ultimoDigito * 25); // Score entre 525 y 750
    let nivelRiesgo = 'BAJO';
    let dictamenRecomendado = 'FAVORABLE';
    let deudasActuales = 0;

    if (score < 600) {
      nivelRiesgo = 'ALTO';
      dictamenRecomendado = 'DESFAVORABLE';
      deudasActuales = 15000.00;
    } else if (score < 680) {
      nivelRiesgo = 'MEDIO';
      dictamenRecomendado = 'FAVORABLE_CON_CONDICION';
      deudasActuales = 4500.00;
    }

    const referenciaExterna = `REF-INFOCRED-${Date.now()}-${ci.slice(-4)}`;

    // Respuesta con el contrato de datos especificado en CU03
    return res.json({
      exito: true,
      proveedor: 'Central de Información Crediticia (Infocred / ASFI)',
      referencia_consulta: referenciaExterna,
      fecha_consulta: new Date().toISOString(),
      cliente: {
        ci: ci,
        score_crediticio: score,
        nivel_riesgo: nivelRiesgo,
        deudas_sistema_financiero: deudasActuales,
        calificacion_entidades: score > 650 ? 'A - Excelente' : 'C - Riesgo Moderado',
        dictamen_recomendado: dictamenRecomendado
      }
    });

  } catch (error) {
    console.error('Error al consultar Sistema de Riesgo Crediticio:', error);
    res.status(500).json({ 
      error: 'Error al comunicarse con el Sistema de Riesgo Crediticio Externo',
      detalle: error.message 
    });
  }
};

// CU11: Solicitud de Desembolso al Sistema Bancario Core
const procesarDesembolsoCore = async (req, res) => {
  try {
    const { id_credito, numero_cuenta, monto } = req.body;

    if (!id_credito || !monto) {
      return res.status(400).json({ error: 'Parámetros insuficientes para procesar desembolso en el Core' });
    }

    // Simulación del procesamiento de la transferencia en el Core Bancario
    const transaccionCore = `TX-CORE-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    return res.json({
      exito: true,
      mensaje: 'Operación de desembolso procesada correctamente en el Core Bancario',
      codigo_transaccion_core: transaccionCore,
      id_credito: id_credito,
      monto_desembolsado: monto,
      cuenta_destino: numero_cuenta || 'CUENTA-MONEDERO-BANCO',
      fecha_procesamiento: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error al comunicarse con el Core Bancario:', error);
    res.status(500).json({ error: 'Error en la interfaz del Core Bancario' });
  }
};

module.exports = {
  consultarRiesgoCrediticio,
  procesarDesembolsoCore
};