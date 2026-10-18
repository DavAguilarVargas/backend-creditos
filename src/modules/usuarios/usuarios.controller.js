
const bcrypt = require('bcryptjs');
const db = require('../../config/db');

const ROLES_PERMITIDOS = [
  'ADMIN',
  'GERENTE',
  'ANALISTA',
  'JEFE',
  'OFICIAL',
  'CAJERO'
];

function validarId(valor) {
  const id = Number(valor);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validarTexto(valor, maximo) {
  return typeof valor === 'string'
    && valor.trim().length > 0
    && valor.trim().length <= maximo;
}

function validarRol(valor) {
  return typeof valor === 'string'
    && ROLES_PERMITIDOS.includes(valor.trim().toUpperCase());
}

function usuarioAutenticado(req) {
  const id = validarId(req.usuario?.id_usuario);

  if (!id) {
    const error = new Error('No se pudo identificar al administrador autenticado.');
    error.status = 401;
    throw error;
  }

  return id;
}

async function auditar(client, idUsuario, operacion, idEntidad) {
  await client.query(
    `INSERT INTO public.auditoria
       (id_usuario, operacion, entidad, id_entidad, resultado)
     VALUES ($1, $2, $3, $4, $5)`,
    [idUsuario, operacion, 'USUARIO', idEntidad, 'EXITO']
  );
}

async function comprobarLoginDisponible(client, login, excluirId = null) {
  const result = await client.query(
    `SELECT id_usuario
       FROM public.usuario
      WHERE LOWER(login) = LOWER($1)
        AND ($2::integer IS NULL OR id_usuario <> $2)
      LIMIT 1`,
    [login, excluirId]
  );

  return result.rows.length === 0;
}

async function asegurarAdministradorActivo(client, idObjetivo, nuevoRol, nuevoActivo) {
  // Bloquea las cuentas ADMIN activas para evitar desactivar
  // accidentalmente la última cuenta administrativa.
  const result = await client.query(
    `SELECT id_usuario
       FROM public.usuario
      WHERE rol = 'ADMIN' AND activo = true
      FOR UPDATE`
  );

  const esAdminActivo = result.rows.some(
    fila => Number(fila.id_usuario) === idObjetivo
  );

  if (esAdminActivo && (nuevoRol !== 'ADMIN' || nuevoActivo !== true)) {
    if (result.rows.length <= 1) {
      const error = new Error(
        'No se puede retirar el rol o desactivar la última cuenta ADMIN activa.'
      );
      error.status = 409;
      throw error;
    }
  }
}

// POST /api/usuarios
exports.crearUsuario = async (req, res) => {
  let client;

  try {
    const idAdministrador = usuarioAutenticado(req);
    const { login, clave, nombre, rol } = req.body || {};

    if (
      !validarTexto(login, 60) ||
      !validarTexto(clave, 128) ||
      clave.length < 8 ||
      !validarTexto(nombre, 150) ||
      !validarRol(rol)
    ) {
      return res.status(400).json({
        error: 'Datos inválidos. Verifique login, nombre, contraseña de al menos 8 caracteres y rol permitido.',
        roles_permitidos: ROLES_PERMITIDOS
      });
    }

    const loginNormalizado = login.trim();
    const nombreNormalizado = nombre.trim();
    const rolNormalizado = rol.trim().toUpperCase();

    client = await db.getClient();
    await client.query('BEGIN');

    if (!(await comprobarLoginDisponible(client, loginNormalizado))) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'El login ya está registrado.' });
    }

    const claveHash = await bcrypt.hash(clave, 10);

    const result = await client.query(
      `INSERT INTO public.usuario
         (login, clave_hash, nombre_completo, rol, activo)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id_usuario, login, nombre_completo AS nombre, rol, activo`,
      [loginNormalizado, claveHash, nombreNormalizado, rolNormalizado]
    );

    const usuario = result.rows[0];

    await auditar(
      client,
      idAdministrador,
      'CREAR_USUARIO',
      usuario.id_usuario
    );

    await client.query('COMMIT');
    return res.status(201).json(usuario);
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }

    if (error.code === '23505') {
      return res.status(409).json({ error: 'El login ya está registrado.' });
    }

    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }

    console.error('Error al crear usuario:', error);
    return res.status(500).json({ error: 'No fue posible crear el usuario.' });
  } finally {
    client?.release();
  }
};

// GET /api/usuarios
exports.listarUsuarios = async (req, res) => {
  try {
    usuarioAutenticado(req);

    const result = await db.query(
      `SELECT id_usuario, login, nombre_completo AS nombre, rol, activo
         FROM public.usuario
        ORDER BY id_usuario ASC`
    );

    return res.json(result.rows);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }

    console.error('Error al listar usuarios:', error);
    return res.status(500).json({ error: 'No fue posible listar los usuarios.' });
  }
};

// PUT /api/usuarios/:id
// Permite actualizar login, nombre, rol y, opcionalmente, contraseña.
exports.modificarUsuario = async (req, res) => {
  let client;

  try {
    const idAdministrador = usuarioAutenticado(req);
    const idObjetivo = validarId(req.params.id);

    if (!idObjetivo) {
      return res.status(400).json({ error: 'Identificador de usuario inválido.' });
    }

    const datos = req.body || {};
    const camposPermitidos = ['login', 'nombre', 'rol', 'clave'];

    if (
      Object.keys(datos).length === 0 ||
      Object.keys(datos).some(campo => !camposPermitidos.includes(campo))
    ) {
      return res.status(400).json({
        error: 'Indique al menos un campo permitido: login, nombre, rol o clave.'
      });
    }

    if (datos.login !== undefined && !validarTexto(datos.login, 60)) {
      return res.status(400).json({ error: 'Login inválido.' });
    }

    if (datos.nombre !== undefined && !validarTexto(datos.nombre, 150)) {
      return res.status(400).json({ error: 'Nombre inválido.' });
    }

    if (datos.rol !== undefined && !validarRol(datos.rol)) {
      return res.status(400).json({
        error: 'Rol no permitido.',
        roles_permitidos: ROLES_PERMITIDOS
      });
    }

    if (
      datos.clave !== undefined &&
      (!validarTexto(datos.clave, 128) || datos.clave.length < 8)
    ) {
      return res.status(400).json({
        error: 'La nueva contraseña debe tener entre 8 y 128 caracteres.'
      });
    }

    client = await db.getClient();
    await client.query('BEGIN');

    const actualResult = await client.query(
      `SELECT id_usuario, login, nombre_completo, rol, activo
         FROM public.usuario
        WHERE id_usuario = $1
        FOR UPDATE`,
      [idObjetivo]
    );

    if (actualResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const actual = actualResult.rows[0];
    const nuevoLogin = datos.login === undefined
      ? actual.login
      : datos.login.trim();
    const nuevoNombre = datos.nombre === undefined
      ? actual.nombre_completo
      : datos.nombre.trim();
    const nuevoRol = datos.rol === undefined
      ? actual.rol
      : datos.rol.trim().toUpperCase();

    // No permitir que el administrador se quite su propio rol ADMIN.
    if (idObjetivo === idAdministrador && nuevoRol !== 'ADMIN') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'No puede retirar su propio rol ADMIN.'
      });
    }

    if (!(await comprobarLoginDisponible(client, nuevoLogin, idObjetivo))) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'El login ya está registrado.' });
    }

    await asegurarAdministradorActivo(
      client,
      idObjetivo,
      nuevoRol,
      actual.activo
    );

    let result;

    if (datos.clave !== undefined) {
      const claveHash = await bcrypt.hash(datos.clave, 10);

      result = await client.query(
        `UPDATE public.usuario
            SET login = $1,
                nombre_completo = $2,
                rol = $3,
                clave_hash = $4
          WHERE id_usuario = $5
          RETURNING id_usuario, login, nombre_completo AS nombre, rol, activo`,
        [nuevoLogin, nuevoNombre, nuevoRol, claveHash, idObjetivo]
      );
    } else {
      result = await client.query(
        `UPDATE public.usuario
            SET login = $1,
                nombre_completo = $2,
                rol = $3
          WHERE id_usuario = $4
          RETURNING id_usuario, login, nombre_completo AS nombre, rol, activo`,
        [nuevoLogin, nuevoNombre, nuevoRol, idObjetivo]
      );
    }

    await auditar(client, idAdministrador, 'MODIFICAR_USUARIO', idObjetivo);
    await client.query('COMMIT');

    return res.json(result.rows[0]);
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }

    if (error.code === '23505') {
      return res.status(409).json({ error: 'El login ya está registrado.' });
    }

    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }

    console.error('Error al modificar usuario:', error);
    return res.status(500).json({ error: 'No fue posible modificar el usuario.' });
  } finally {
    client?.release();
  }
};

// PATCH /api/usuarios/:id/estado
exports.cambiarEstadoUsuario = async (req, res) => {
  let client;

  try {
    const idAdministrador = usuarioAutenticado(req);
    const idObjetivo = validarId(req.params.id);
    const { activo } = req.body || {};

    if (!idObjetivo) {
      return res.status(400).json({ error: 'Identificador de usuario inválido.' });
    }

    if (typeof activo !== 'boolean') {
      return res.status(400).json({
        error: 'El campo activo debe ser true o false.'
      });
    }

    if (idObjetivo === idAdministrador && activo === false) {
      return res.status(409).json({
        error: 'No puede desactivar su propia cuenta mientras está autenticado.'
      });
    }

    client = await db.getClient();
    await client.query('BEGIN');

    const actualResult = await client.query(
      `SELECT id_usuario, rol, activo
         FROM public.usuario
        WHERE id_usuario = $1
        FOR UPDATE`,
      [idObjetivo]
    );

    if (actualResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const actual = actualResult.rows[0];

    if (actual.activo === activo) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `El usuario ya está ${activo ? 'activo' : 'inactivo'}.`
      });
    }

    await asegurarAdministradorActivo(
      client,
      idObjetivo,
      actual.rol,
      activo
    );

    const result = await client.query(
      `UPDATE public.usuario
          SET activo = $1
        WHERE id_usuario = $2
        RETURNING id_usuario, login, nombre_completo AS nombre, rol, activo`,
      [activo, idObjetivo]
    );

    await auditar(
      client,
      idAdministrador,
      activo ? 'ACTIVAR_USUARIO' : 'DESACTIVAR_USUARIO',
      idObjetivo
    );

    await client.query('COMMIT');
    return res.json(result.rows[0]);
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }

    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }

    console.error('Error al cambiar estado de usuario:', error);
    return res.status(500).json({ error: 'No fue posible cambiar el estado del usuario.' });
  } finally {
    client?.release();
  }
};
