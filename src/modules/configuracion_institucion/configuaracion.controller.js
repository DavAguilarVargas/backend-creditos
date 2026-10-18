const db = require('../../config/db');

const DEFAULT_CONFIG = {
  id: null,
  razon_social: '',
  nit: '',
  direccion: '',
  telefono: '',
  moneda_base: 'BOB',
  tasa_interes_penal_diaria: '0.0010',
  url_logo: '',
  color_primario: '#0F172A',
  color_secundario: '#0369A1',
  color_acento: '#0EA5E9',
  correo_contacto: '',
  sitio_web: '',
  domicilio_legal: '',
  representante_legal: '',
  documento_representante: '',
  cargo_representante: '',
  referencia_facultades: '',
};

const SELECT_CONFIG = `
  SELECT id, razon_social, nit, direccion, telefono, moneda_base,
         tasa_interes_penal_diaria, url_logo,
         color_primario, color_secundario, color_acento,
         correo_contacto, sitio_web, domicilio_legal,
         representante_legal, documento_representante,
         cargo_representante, referencia_facultades
  FROM public.configuracion_institucion
`;

function errorOperacion(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function textOrEmpty(value) {
  return value == null ? '' : String(value).trim();
}

function validHex(value) {
  return /^#[0-9A-Fa-f]{6}$/.test(String(value || ''));
}

function validarUrlOBlanco(value, label) {
  const text = textOrEmpty(value);
  if (!text) return '';
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw errorOperacion(400, `${label} debe ser una URL válida.`);
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw errorOperacion(400, `${label} debe comenzar con http:// o https://.`);
  }
  return text;
}

function userId(req) {
  const id = Number(req.usuario?.id_usuario);
  if (!Number.isInteger(id) || id <= 0) {
    throw errorOperacion(401, 'No se pudo identificar al usuario autenticado. Inicie sesión nuevamente.');
  }
  return id;
}

exports.obtenerConfiguracion = async (_req, res) => {
  try {
    // Endpoint público: solo datos corporativos que pueden mostrarse en login/dashboard.
    const result = await db.query(
      `SELECT id, razon_social, nit, direccion, telefono, moneda_base,
              tasa_interes_penal_diaria, url_logo, color_primario,
              color_secundario, color_acento, correo_contacto, sitio_web
       FROM public.configuracion_institucion
       ORDER BY id DESC LIMIT 1`
    );
    const {
      domicilio_legal, representante_legal, documento_representante,
      cargo_representante, referencia_facultades, ...publicDefaults
    } = DEFAULT_CONFIG;
    return res.json({ configuracion: { ...publicDefaults, ...(result.rows[0] || {}) } });
  } catch (error) {
    console.error('Error al consultar configuración institucional:', error);
    return res.status(500).json({
      error: 'No fue posible consultar la configuración institucional. Verifique que se haya aplicado la migración de identidad visual.',
    });
  }
};

exports.obtenerConfiguracionAdmin = async (_req, res) => {
  try {
    const result = await db.query(`${SELECT_CONFIG} ORDER BY id DESC LIMIT 1`);
    return res.json({ configuracion: { ...DEFAULT_CONFIG, ...(result.rows[0] || {}) } });
  } catch (error) {
    console.error('Error al consultar la configuración administrativa:', error);
    return res.status(500).json({ error: 'No fue posible consultar la configuración administrativa.' });
  }
};

exports.actualizarConfiguracion = async (req, res) => {
  let client;
  let transactionStarted = false;

  try {
    const idUsuario = userId(req);
    const body = req.body || {};
    const razonSocial = textOrEmpty(body.razon_social);
    const nit = textOrEmpty(body.nit);

    if (!razonSocial || razonSocial.length > 150) {
      throw errorOperacion(400, 'La razón social es obligatoria y no debe superar 150 caracteres.');
    }
    if (!nit || nit.length > 50) {
      throw errorOperacion(400, 'El NIT es obligatorio y no debe superar 50 caracteres.');
    }

    const colors = {
      color_primario: textOrEmpty(body.color_primario || DEFAULT_CONFIG.color_primario),
      color_secundario: textOrEmpty(body.color_secundario || DEFAULT_CONFIG.color_secundario),
      color_acento: textOrEmpty(body.color_acento || DEFAULT_CONFIG.color_acento),
    };
    for (const [field, value] of Object.entries(colors)) {
      if (!validHex(value)) throw errorOperacion(400, `${field} debe ser un color hexadecimal, por ejemplo #0F172A.`);
    }

    const moneda = textOrEmpty(body.moneda_base || 'BOB').toUpperCase();
    if (!moneda || moneda.length > 10) throw errorOperacion(400, 'La moneda base debe tener entre 1 y 10 caracteres.');

    const tasaPenal = Number(body.tasa_interes_penal_diaria ?? DEFAULT_CONFIG.tasa_interes_penal_diaria);
    if (!Number.isFinite(tasaPenal) || tasaPenal < 0 || tasaPenal > 9.9999) {
      throw errorOperacion(400, 'La tasa penal diaria debe ser un número entre 0 y 9.9999.');
    }

    const direccion = textOrEmpty(body.direccion);
    const telefono = textOrEmpty(body.telefono);
    const urlLogo = validarUrlOBlanco(body.url_logo, 'La URL del logo');
    const sitioWeb = validarUrlOBlanco(body.sitio_web, 'El sitio web');
    const correo = textOrEmpty(body.correo_contacto);
    if (correo && (correo.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo))) {
      throw errorOperacion(400, 'El correo de contacto no tiene un formato válido.');
    }

    const domicilioLegal = textOrEmpty(body.domicilio_legal);
    const representante = textOrEmpty(body.representante_legal);
    const documentoRepresentante = textOrEmpty(body.documento_representante);
    const cargoRepresentante = textOrEmpty(body.cargo_representante);
    const referenciaFacultades = textOrEmpty(body.referencia_facultades);
    const boundedFields = [
      ['direccion', direccion, 500], ['telefono', telefono, 50],
      ['sitio_web', sitioWeb, 200], ['representante_legal', representante, 150],
      ['documento_representante', documentoRepresentante, 50],
      ['cargo_representante', cargoRepresentante, 100],
    ];
    for (const [label, value, max] of boundedFields) {
      if (value.length > max) throw errorOperacion(400, `${label} no debe superar ${max} caracteres.`);
    }

    client = await db.getClient();
    await client.query('BEGIN');
    transactionStarted = true;

    // La tabla existente no tiene un indicador de fila singleton. El bloqueo
    // advisory evita insertar dos filas iniciales simultáneamente en este endpoint.
    await client.query('SELECT pg_advisory_xact_lock($1)', [72841018]);
    const current = await client.query(
      `SELECT id FROM public.configuracion_institucion ORDER BY id DESC LIMIT 1 FOR UPDATE`
    );

    const values = [
      razonSocial, nit, direccion || null, telefono || null, moneda,
      tasaPenal, urlLogo || null, colors.color_primario,
      colors.color_secundario, colors.color_acento, correo || null,
      sitioWeb || null, domicilioLegal || null, representante || null,
      documentoRepresentante || null, cargoRepresentante || null,
      referenciaFacultades || null,
    ];

    let saved;
    if (current.rowCount > 0) {
      const id = current.rows[0].id;
      saved = await client.query(
        `UPDATE public.configuracion_institucion SET
           razon_social = $1, nit = $2, direccion = $3, telefono = $4,
           moneda_base = $5, tasa_interes_penal_diaria = $6, url_logo = $7,
           color_primario = $8, color_secundario = $9, color_acento = $10,
           correo_contacto = $11, sitio_web = $12, domicilio_legal = $13,
           representante_legal = $14, documento_representante = $15,
           cargo_representante = $16, referencia_facultades = $17
         WHERE id = $18
         RETURNING *`,
        [...values, id]
      );
    } else {
      saved = await client.query(
        `INSERT INTO public.configuracion_institucion (
           razon_social, nit, direccion, telefono, moneda_base,
           tasa_interes_penal_diaria, url_logo, color_primario,
           color_secundario, color_acento, correo_contacto, sitio_web,
           domicilio_legal, representante_legal, documento_representante,
           cargo_representante, referencia_facultades
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
           $13, $14, $15, $16, $17
         ) RETURNING *`,
        values
      );
    }

    await client.query(
      `INSERT INTO public.auditoria (id_usuario, operacion, entidad, id_entidad, resultado)
       VALUES ($1, 'ACTUALIZAR_CONFIGURACION_INSTITUCION', 'CONFIGURACION_INSTITUCION', $2, 'EXITO')`,
      [idUsuario, saved.rows[0].id]
    );

    await client.query('COMMIT');
    transactionStarted = false;
    return res.json({ mensaje: 'Configuración institucional actualizada.', configuracion: saved.rows[0] });
  } catch (error) {
    if (client && transactionStarted) await client.query('ROLLBACK').catch(() => {});
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('Error al guardar configuración institucional:', error);
    return res.status(500).json({ error: 'No fue posible guardar la configuración institucional.' });
  } finally {
    if (client) client.release();
  }
};
