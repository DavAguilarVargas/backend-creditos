/**
 * Cronograma francés con importes en centavos y vencimientos mensuales
 * que conservan el día de referencia (o el último día disponible del mes).
 * La tasa anual recibida se interpreta como nominal anual porcentual y se
 * divide entre 12, conforme al criterio utilizado por el proyecto.
 */
function redondearCentavos(valor) {
  return Math.round(valor + Number.EPSILON);
}

function formatearFechaUTC(fecha) {
  const y = fecha.getUTCFullYear();
  const m = String(fecha.getUTCMonth() + 1).padStart(2, '0');
  const d = String(fecha.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parsearFechaBase(fechaBase) {
  if (fechaBase instanceof Date && !Number.isNaN(fechaBase.getTime())) {
    return new Date(Date.UTC(
      fechaBase.getUTCFullYear(),
      fechaBase.getUTCMonth(),
      fechaBase.getUTCDate()
    ));
  }

  if (typeof fechaBase === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fechaBase)) {
    const [anio, mes, dia] = fechaBase.split('-').map(Number);
    const fecha = new Date(Date.UTC(anio, mes - 1, dia));
    if (
      fecha.getUTCFullYear() !== anio ||
      fecha.getUTCMonth() !== mes - 1 ||
      fecha.getUTCDate() !== dia
    ) {
      throw new Error('La fecha base del cronograma no es válida.');
    }
    return fecha;
  }

  throw new Error('La fecha base debe tener formato YYYY-MM-DD.');
}

function sumarMesesConDiaReferencia(fechaBase, meses) {
  const anioBase = fechaBase.getUTCFullYear();
  const mesBase = fechaBase.getUTCMonth();
  const diaReferencia = fechaBase.getUTCDate();
  const primerDiaDestino = new Date(Date.UTC(anioBase, mesBase + meses, 1));
  const ultimoDiaDestino = new Date(Date.UTC(
    primerDiaDestino.getUTCFullYear(),
    primerDiaDestino.getUTCMonth() + 1,
    0
  )).getUTCDate();

  return new Date(Date.UTC(
    primerDiaDestino.getUTCFullYear(),
    primerDiaDestino.getUTCMonth(),
    Math.min(diaReferencia, ultimoDiaDestino)
  ));
}

function generarCronogramaFrances(montoCapital, tasaAnual, plazoMeses, fechaBase) {
  const monto = Number(montoCapital);
  const tasa = Number(tasaAnual);
  const plazo = Number(plazoMeses);

  if (!Number.isFinite(monto) || monto <= 0) {
    throw new Error('El monto del crédito debe ser mayor que cero.');
  }
  if (!Number.isFinite(tasa) || tasa < 0) {
    throw new Error('La tasa anual debe ser un número mayor o igual a cero.');
  }
  if (!Number.isInteger(plazo) || plazo <= 0 || plazo > 600) {
    throw new Error('El plazo debe ser un número entero entre 1 y 600 meses.');
  }

  const base = parsearFechaBase(fechaBase);
  const capitalInicialCentavos = redondearCentavos(monto * 100);
  const tasaMensual = (tasa / 100) / 12;
  let saldoCentavos = capitalInicialCentavos;

  let cuotaFijaCentavos;
  if (tasaMensual === 0) {
    cuotaFijaCentavos = redondearCentavos(capitalInicialCentavos / plazo);
  } else {
    const factor = Math.pow(1 + tasaMensual, plazo);
    const cuota = (monto * (tasaMensual * factor)) / (factor - 1);
    cuotaFijaCentavos = redondearCentavos(cuota * 100);
  }

  if (!Number.isFinite(cuotaFijaCentavos) || cuotaFijaCentavos <= 0) {
    throw new Error('No se pudo calcular una cuota válida con los parámetros indicados.');
  }

  const cronograma = [];

  for (let indice = 1; indice <= plazo; indice += 1) {
    const interesCentavos = redondearCentavos(saldoCentavos * tasaMensual);
    let capitalCentavos;
    let cuotaCentavos;

    if (indice === plazo) {
      // La última cuota cancela el saldo de capital exactamente.
      capitalCentavos = saldoCentavos;
      cuotaCentavos = capitalCentavos + interesCentavos;
    } else {
      cuotaCentavos = cuotaFijaCentavos;
      capitalCentavos = cuotaCentavos - interesCentavos;

      // Evita un saldo negativo si existen parámetros extremos o redondeos.
      if (capitalCentavos <= 0) {
        throw new Error('La cuota calculada no amortiza capital; revise la tasa y el plazo.');
      }
      if (capitalCentavos > saldoCentavos) {
        capitalCentavos = saldoCentavos;
        cuotaCentavos = capitalCentavos + interesCentavos;
      }
    }

    saldoCentavos -= capitalCentavos;
    if (saldoCentavos < 0) saldoCentavos = 0;

    const vencimiento = sumarMesesConDiaReferencia(base, indice);
    cronograma.push({
      numero_cuota: indice,
      fecha_vencimiento: formatearFechaUTC(vencimiento),
      monto_capital: capitalCentavos / 100,
      monto_interes: interesCentavos / 100,
      monto_total: cuotaCentavos / 100,
      saldo_restante: saldoCentavos / 100,
    });
  }

  if (saldoCentavos !== 0) {
    throw new Error('El cronograma generado no cancela el saldo de capital.');
  }

  return cronograma;
}

module.exports = { generarCronogramaFrances };
