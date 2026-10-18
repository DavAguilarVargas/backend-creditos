const db = require('../../config/db');

const CAMPOS_CLIENTE = [
  'ci', 'expedido', 'nombres', 'apellidos', 'fecha_nacimiento',
  'estado_civil', 'profesion_ocupacion', 'ingresos_fijos',
  'ingresos_variables', 'direccion_domicilio', 'telefono_contacto', 'correo'
];

function normalizarCliente(body = {}) {
  const ci = String(body.ci || '').trim();
  const nombres = String(body.nombres || '').trim();
  const apellidos = String(body.apellidos || '').trim();
  const fechaNacimiento = String(body.fecha_nacimiento || '').trim();
  const ingresosFijos = body.ingresos_fijos === '' || body.ingresos_fijos == null
    ? 0 : Number(body.ingresos_fijos);
  const ingresosVariables = body.ingresos_variables === '' || body.ingresos_variables == null
    ? 0 : Number(body.ingresos_variables);

  if (!ci || !nombres || !apellidos || !fechaNacimiento) {
    const error = new Error('Los campos CI, nombres, apellidos y fecha de nacimiento son obligatorios.');
    error.status = 400;
    throw error;
  }

  if (!Number.isFinite(ingresosFijos) || ingresosFijos < 0 ||
      !Number.isFinite(ingresosVariables) || ingresosVariables < 0) {
    const error = new Error('Los ingresos fijos y variables deben ser valores numéricos mayores o iguales a cero.');
    error.status = 400;
    throw error;
  }

  return {
    ci,
    expedido: String(body.expedido || '').trim() || null,
    nombres,
    apellidos,
    fecha_nacimiento: fechaNacimiento,
    estado_civil: String(body.estado_civil || '').trim() || null,
    profesion_ocupacion: String(body.profesion_ocupacion || '').trim() || null,
    ingresos_fijos: ingresosFijos,
    ingresos_variables: ingresosVariables,
    direccion_domicilio: String(body.direccion_domicilio || '').trim() || null,
    telefono_contacto: String(body.telefono_contacto || '').trim() || null,
    correo: String(body.correo || '').trim() || null,
  };
}

function responderError(res, error, accion) {
  if (error.status) {
    return res.status(error.status).json({ error: error.message });
  }
  if (error.code === '23505') {
    return res.status(409).json({ error: 'Ya existe un cliente registrado con ese CI.' });
  }
  if (error.code === '23514' || error.code === '22007' || error.code === '22P02') {
    return res.status(400).json({ error: 'Los datos proporcionados no cumplen el formato esperado.' });
  }
  console.error(`${accion}:`, error);
  return res.status(500).json({ error: 'No fue posible completar la operación de clientes.' });
}

exports.registrarCliente = async (req, res) => {
  try {
    const cliente = normalizarCliente(req.body);
    const result = await db.query(
      `INSERT INTO public.cliente (
        ci, expedido, nombres, apellidos, fecha_nacimiento,
        estado_civil, profesion_ocupacion, ingresos_fijos,
        ingresos_variables, direccion_domicilio, telefono_contacto, correo
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      ) RETURNING *,
        to_char((fecha_registro AT TIME ZONE 'UTC') AT TIME ZONE 'America/La_Paz',
                'YYYY-MM-DD HH24:MI:SS') AS fecha_registro_local`,
      CAMPOS_CLIENTE.map((campo) => cliente[campo])
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return responderError(res, error, 'Error al registrar cliente');
  }
};

exports.actualizarCliente = async (req, res) => {
  const idCliente = Number(req.params.id);
  if (!Number.isInteger(idCliente) || idCliente <= 0) {
    return res.status(400).json({ error: 'El ID del cliente no es válido.' });
  }

  try {
    const cliente = normalizarCliente(req.body);
    const result = await db.query(
      `UPDATE public.cliente SET
        ci = $1, expedido = $2, nombres = $3, apellidos = $4,
        fecha_nacimiento = $5, estado_civil = $6,
        profesion_ocupacion = $7, ingresos_fijos = $8,
        ingresos_variables = $9, direccion_domicilio = $10,
        telefono_contacto = $11, correo = $12
       WHERE id_cliente = $13
       RETURNING *,
         to_char((fecha_registro AT TIME ZONE 'UTC') AT TIME ZONE 'America/La_Paz',
                 'YYYY-MM-DD HH24:MI:SS') AS fecha_registro_local`,
      [...CAMPOS_CLIENTE.map((campo) => cliente[campo]), idCliente]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'El cliente solicitado no existe.' });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    return responderError(res, error, 'Error al actualizar cliente');
  }
};

exports.obtenerClientes = async (req, res) => {
  try {
    const ci = String(req.query.ci || '').trim();
    if (ci) {
      const result = await db.query(
        `SELECT *,
          to_char((fecha_registro AT TIME ZONE 'UTC') AT TIME ZONE 'America/La_Paz',
                  'YYYY-MM-DD HH24:MI:SS') AS fecha_registro_local
         FROM public.cliente WHERE ci = $1 ORDER BY id_cliente DESC`,
        [ci]
      );
      return res.json(result.rows);
    }

    const result = await db.query(
      `SELECT *,
        to_char((fecha_registro AT TIME ZONE 'UTC') AT TIME ZONE 'America/La_Paz',
                'YYYY-MM-DD HH24:MI:SS') AS fecha_registro_local
       FROM public.cliente ORDER BY fecha_registro DESC NULLS LAST, id_cliente DESC`
    );
    return res.json(result.rows);
  } catch (error) {
    return responderError(res, error, 'Error al consultar clientes');
  }
};
