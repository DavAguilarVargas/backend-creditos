function generarCronogramaFrances(monto, tasaAnual, plazoMeses, fechaInicio = new Date()) {
  const i = (tasaAnual / 100) / 12;
  const cuotaMensual = (monto * (i * Math.pow(1 + i, plazoMeses))) / (Math.pow(1 + i, plazoMeses) - 1);
  
  let saldoCapital = monto;
  const cronograma = [];

  for (let numero = 1; numero <= plazoMeses; numero++) {
    const interes = saldoCapital * i;
    const capital = cuotaMensual - interes;
    saldoCapital -= capital;

    const fechaVencimiento = new Date(fechaInicio);
    fechaVencimiento.setMonth(fechaVencimiento.getMonth() + numero);

    cronograma.push({
      numero,
      fecha_vencimiento: fechaVencimiento.toISOString().split('T')[0],
      capital: parseFloat(capital.toFixed(2)),
      interes: parseFloat(interes.toFixed(2)),
      monto: parseFloat(cuotaMensual.toFixed(2)),
      saldo: parseFloat(Math.max(0, saldoCapital).toFixed(2))
    });
  }

  return cronograma;
}

module.exports = { generarCronogramaFrances };