/* =====================================================================
 * LIMATCO · CONTROL DE ACOPIOS — Backend Google Apps Script
 * Desarrollado por ISI LABS
 * ---------------------------------------------------------------------
 * Base de datos: planilla "Acopios 1 y 2 / 2026", pestañas APP_*
 * Solo lectura (no se modifican):
 *   'fisico'            → export del ERP (DIS, Físico, ubicación de picking)
 *   'TABLA DE CODIGOS ' → maestro de productos (m² por caja)
 *   'acopio 1', 'acopio 2', 'SALIDAS', 'PEGAMENTOS' → solo para la migración inicial
 *
 * PRIMERA VEZ:
 *   1) Cambiar ADMIN_CLAVE_INICIAL abajo.
 *   2) Ejecutar setup()  (crea pestañas APP_* y el usuario admin).
 *   3) Ejecutar migrarDatosIniciales()  (una sola vez).
 *   4) Implementar → Nueva implementación → Aplicación web
 *        Ejecutar como: Yo · Quién tiene acceso: Cualquier usuario
 *
 * ¡OJO CON EL DESPLIEGUE! Guardar no basta. Después de cada cambio:
 *   Implementar → Administrar implementaciones → lápiz → Versión: Nueva versión → Implementar
 * ===================================================================== */

const VERSION = '1.0.0';

// ============================ CONFIGURACIÓN ============================
const CFG = {
  SPREADSHEET_ID: '1CYiBZNVR28hzCVucHLw_6hoRg_B6q6xNM_6uo6psqYU', // vacío = planilla contenedora
  ZONA: 'America/Santiago',
  SAL: 'limatco-acopios',              // debe coincidir con CONFIG.SAL del index.html
  ADMIN_USUARIO: 'admin',
  ADMIN_NOMBRE: 'Administrador',
  ADMIN_CLAVE_INICIAL: 'CambiarEsta2026', // ← cambiar ANTES de ejecutar setup()
  TOKEN_HORAS: 14,                     // duración de la sesión (un turno largo)
  MAX_PALLETS_POR_ENTRADA: 60,
  MAX_ITEMS_POR_LOTE: 80,
  MAX_FILAS_CONSULTA: 15000,
  FILAS_GRUEROS: 4000,                 // últimas filas de movimientos para armar la lista de grueros
};

const HOJA = {
  PALLETS: 'APP_PALLETS',              // stock vivo: 1 fila = 1 pallet en acopio
  HIST: 'APP_PALLETS_HIST',            // pallets que ya salieron (trazabilidad del QR)
  MOV: 'APP_MOVIMIENTOS',              // log inmutable de entradas, salidas, traslados y ajustes
  UBIC: 'APP_UBICACIONES',             // maestro de posiciones con capacidad
  USR: 'APP_USUARIOS',
  PROD: 'APP_PRODUCTOS',               // productos creados desde la app (no están en el maestro)
  SALIDAS: 'APP_SALIDAS',              // vista QUERY: planilla de salida con fecha y hora
  LOG: 'APP_LOG_MIGRACION',
};

const ORIGEN = {
  ACOPIO: { '1': 'acopio 1', '2': 'acopio 2' },
  SALIDAS: 'SALIDAS',
  PEGAMENTOS: 'PEGAMENTOS',
  MAESTRO: 'TABLA DE CODIGOS',         // se busca sin importar el espacio final del nombre
  ERP: 'fisico',
};

const COL = {
  PALLETS: ['ID', 'CODIGO', 'DESCRIPCION', 'UNIDAD', 'RENDIMIENTO', 'CAJAS_INI', 'CAJAS', 'MTS', 'TONO', 'CALIBRE',
            'ACOPIO', 'UBICACION', 'FECHA_INGRESO', 'USUARIO_INGRESO', 'ULT_MOV', 'OBS', 'ORIGEN'],
  MOV: ['ID_MOV', 'FECHA_HORA', 'TIPO', 'ID_PALLET', 'CODIGO', 'DESCRIPCION', 'UNIDAD', 'CAJAS', 'MTS', 'TONO', 'CALIBRE',
        'ACOPIO_ORIG', 'UBIC_ORIG', 'ACOPIO_DEST', 'UBIC_DEST', 'DESTINO', 'DETALLE', 'GRUERO', 'USUARIO', 'OBS', 'OP_ID'],
  UBIC: ['ACOPIO', 'UBICACION', 'PASILLO', 'NUMERO', 'CAPACIDAD', 'TIPO', 'ACTIVA', 'OBS'],
  USR: ['USUARIO', 'NOMBRE', 'HASH', 'ROL', 'ACTIVO', 'CREADO', 'ULT_ACCESO'],
  PROD: ['CODIGO', 'DESCRIPCION', 'RENDIMIENTO', 'UNIDAD', 'CREADO', 'USUARIO'],
  LOG: ['FECHA', 'ORIGEN', 'FILA', 'CAMPO', 'VALOR_ORIGINAL', 'VALOR_APP', 'NOTA'],
};
COL.HIST = COL.PALLETS.concat(['FECHA_CIERRE', 'MOTIVO_CIERRE']);

// Índices de columna por nombre: IX.PALLETS.CODIGO → 1
const IX = Object.keys(COL).reduce(function (acc, k) {
  acc[k] = COL[k].reduce(function (m, h, i) { m[h] = i; return m; }, {});
  return acc;
}, {});

// Columnas que se guardan como texto (evita que "1E2" o "00123" se transformen)
const COL_TEXTO = {
  PALLETS: ['ID', 'CODIGO', 'UNIDAD', 'TONO', 'CALIBRE', 'ACOPIO', 'UBICACION', 'USUARIO_INGRESO', 'ORIGEN'],
  HIST: ['ID', 'CODIGO', 'UNIDAD', 'TONO', 'CALIBRE', 'ACOPIO', 'UBICACION', 'USUARIO_INGRESO', 'ORIGEN', 'MOTIVO_CIERRE'],
  MOV: ['ID_MOV', 'TIPO', 'ID_PALLET', 'CODIGO', 'UNIDAD', 'TONO', 'CALIBRE', 'ACOPIO_ORIG', 'UBIC_ORIG', 'ACOPIO_DEST',
        'UBIC_DEST', 'DESTINO', 'DETALLE', 'GRUERO', 'USUARIO', 'OP_ID'],
  UBIC: ['ACOPIO', 'UBICACION', 'PASILLO', 'TIPO', 'ACTIVA'],
  USR: ['USUARIO', 'HASH', 'ROL', 'ACTIVO'],
  PROD: ['CODIGO', 'UNIDAD', 'USUARIO'],
  LOG: [],
};
const COL_FECHA = {
  PALLETS: ['FECHA_INGRESO', 'ULT_MOV'],
  HIST: ['FECHA_INGRESO', 'ULT_MOV', 'FECHA_CIERRE'],
  MOV: ['FECHA_HORA'],
  UBIC: [], USR: ['CREADO', 'ULT_ACCESO'], PROD: ['CREADO'], LOG: ['FECHA'],
};

const ROLES = { CONSULTA: 1, OPERADOR: 2, SUPERVISOR: 3, ADMIN: 4 };
const TIPOS_UBIC = ['POSICION', 'PISO', 'ZONA'];
const DESTINOS = ['PICKING', 'DESPACHO', 'FLETE', 'OTRO'];

// ============================ ENRUTADOR ============================
const ACCIONES = {
  bootstrap:        { rol: 'CONSULTA',   fn: bootstrap_ },
  productos:        { rol: 'CONSULTA',   fn: productos_ },
  erp:              { rol: 'CONSULTA',   fn: erpConsulta_ },
  pallet:           { rol: 'CONSULTA',   fn: palletInfo_ },
  movimientos:      { rol: 'CONSULTA',   fn: movimientos_ },
  historial:        { rol: 'CONSULTA',   fn: historial_ },
  entrada:          { rol: 'OPERADOR',   fn: entrada_,   escritura: true, op: true },
  salida:           { rol: 'OPERADOR',   fn: salida_,    escritura: true, op: true },
  traslado:         { rol: 'OPERADOR',   fn: traslado_,  escritura: true, op: true },
  ajuste:           { rol: 'SUPERVISOR', fn: ajuste_,    escritura: true, op: true },
  crearProducto:    { rol: 'OPERADOR',   fn: crearProducto_,    escritura: true },
  guardarUbicacion: { rol: 'SUPERVISOR', fn: guardarUbicacion_, escritura: true },
  capacidadMasiva:  { rol: 'SUPERVISOR', fn: capacidadMasiva_,  escritura: true },
  crearRango:       { rol: 'SUPERVISOR', fn: crearRango_,       escritura: true },
  usuarios:         { rol: 'ADMIN',      fn: usuarios_ },
  guardarUsuario:   { rol: 'ADMIN',      fn: guardarUsuario_,   escritura: true },
  cambiarClave:     { rol: 'CONSULTA',   fn: cambiarClave_,     escritura: true },
};

function doGet() {
  return json_({ ok: true, app: 'LIMATCO Acopios', version: VERSION, hora: new Date().toISOString() });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Solicitud inválida (JSON)' });
  }
  return json_(despachar_(req));
}

function despachar_(req) {
  try {
    const accion = String(req.accion || '');
    if (accion === 'ping') return { ok: true, version: VERSION, ahora: Date.now() };
    if (accion === 'login') return login_(req);

    const ses = verificarToken_(req.token);
    if (!ses) return { ok: false, code: 'AUTH', error: 'Sesión expirada. Vuelve a ingresar.' };

    const def = ACCIONES[accion];
    if (!def) return { ok: false, error: 'Acción desconocida: ' + accion };
    if (ROLES[ses.rol] < ROLES[def.rol]) return { ok: false, code: 'PERMISO', error: 'Tu rol (' + ses.rol + ') no permite esta acción.' };

    if (!def.escritura) return def.fn(req, ses);

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) return { ok: false, code: 'OCUPADO', error: 'El servidor está ocupado, reintenta en unos segundos.' };
    try {
      if (def.op && req.opId) {
        const previa = opProcesada_(String(req.opId));
        if (previa) return previa;
      }
      const res = def.fn(req, ses);
      SpreadsheetApp.flush();
      return res;
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ============================ UTILIDADES ============================
let _ss = null, _hojas = null;
function ss_() {
  if (!_ss) _ss = CFG.SPREADSHEET_ID ? SpreadsheetApp.openById(CFG.SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  return _ss;
}

/** Busca una hoja por nombre ignorando mayúsculas y espacios sobrantes. */
function hoja_(nombre, obligatoria) {
  if (!_hojas) {
    _hojas = {};
    ss_().getSheets().forEach(function (s) { _hojas[s.getName().trim().toLowerCase()] = s; });
  }
  const sh = _hojas[String(nombre).trim().toLowerCase()] || null;
  if (!sh && obligatoria) throw new Error('No existe la hoja "' + nombre + '". Ejecuta setup().');
  return sh;
}

function leer_(clave) {
  const sh = hoja_(HOJA[clave], true);
  const ncol = COL[clave].length;
  const last = sh.getLastRow();
  const filas = last > 1 ? sh.getRange(2, 1, last - 1, ncol).getValues() : [];
  return { sh: sh, filas: filas };
}

function agregar_(clave, filas) {
  if (!filas || !filas.length) return;
  const sh = hoja_(HOJA[clave], true);
  const desde = sh.getLastRow() + 1;
  const necesarias = desde + filas.length - 1;
  if (sh.getMaxRows() < necesarias) {
    const antes = sh.getMaxRows(), extra = necesarias - antes + 500;
    sh.insertRowsAfter(antes, extra);
    formatearFilas_(clave, sh, antes + 1, extra); // texto como texto (tono "1E2", códigos con ceros) y fechas con hora
  }
  sh.getRange(desde, 1, filas.length, COL[clave].length).setValues(filas);
}

function formatearFilas_(clave, sh, desde, n) {
  (COL_TEXTO[clave] || []).forEach(function (h) { sh.getRange(desde, IX[clave][h] + 1, n, 1).setNumberFormat('@'); });
  (COL_FECHA[clave] || []).forEach(function (h) { sh.getRange(desde, IX[clave][h] + 1, n, 1).setNumberFormat('dd-mm-yyyy hh:mm:ss'); });
}

/** Borra filas (números de fila de la hoja) agrupando consecutivas, de abajo hacia arriba. */
function borrarFilas_(sh, numeros) {
  const orden = numeros.slice().sort(function (a, b) { return b - a; });
  let i = 0;
  while (i < orden.length) {
    let fin = orden[i], ini = fin;
    while (i + 1 < orden.length && orden[i + 1] === ini - 1) { ini = orden[i + 1]; i++; }
    sh.deleteRows(ini, fin - ini + 1);
    i++;
  }
}

function num_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (v === null || v === undefined || v === '') return 0;
  let s = String(v).trim().replace(/\s/g, '').replace(/\$/g, '');
  if (!s) return 0;
  if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.indexOf(',') >= 0) s = s.replace(',', '.');
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}
function r4_(n) { return Math.round((Number(n) || 0) * 10000) / 10000; }
function normCodigo_(v) { return String(v === null || v === undefined ? '' : v).trim().toUpperCase(); }

/** Tono / calibre: "no", "NO", "-", "#N/A" → vacío. */
function normTxt_(v) {
  const s = String(v === null || v === undefined ? '' : v).trim().toUpperCase();
  if (s === 'NO' || s === '-' || s === 'N/A' || s.charAt(0) === '#') return '';
  return s;
}

/** Normaliza una ubicación de acopio. Devuelve {v, nota}. */
function normUbic_(raw) {
  const original = String(raw === null || raw === undefined ? '' : raw).trim();
  const s = original.toUpperCase().replace(/\s+/g, '');
  if (!s) return { v: 'SIN-UBIC', nota: 'Ubicación vacía' };
  let m = s.match(/^([A-Z])-?0*(\d{1,3})$/);
  if (m) {
    const v = m[1] + '-' + String(parseInt(m[2], 10)).padStart(2, '0');
    return { v: v, nota: v === original ? '' : 'Formato corregido' };
  }
  m = s.match(/^([A-Z])-?0*(\d{1,3})[,.](\d{1,2})$/);
  if (m) return { v: m[1] + '-' + String(parseInt(m[2], 10)).padStart(2, '0') + '.' + m[3], nota: 'Subposición con coma normalizada' };
  return { v: s, nota: (s === 'PISO' || s === 'PEGAMENTOS') ? '' : 'Formato no estándar, revisar' };
}

function partesUbic_(ubic) {
  const m = String(ubic).match(/^([A-Z]+)-(\d+)(?:\.(\d+))?$/);
  if (!m) return { pasillo: String(ubic), numero: 0 };
  return { pasillo: m[1], numero: parseFloat(m[2] + (m[3] ? '.' + m[3] : '')) };
}

function ms_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
  return null;
}

/** Acepta Date, "dd-mm-yy", "dd-mm-yyyy", "dd/mm/yy", "dd-mm" (año actual). Devuelve Date a las 12:00 o null. */
function fecha_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return new Date(v.getFullYear(), v.getMonth(), v.getDate(), 12, 0, 0);
  const s = String(v === null || v === undefined ? '' : v).trim();
  const m = s.match(/^(\d{1,2})[-\/.](\d{1,2})(?:[-\/.](\d{2,4}))?$/);
  if (!m) return null;
  const d = parseInt(m[1], 10), mes = parseInt(m[2], 10);
  let a = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
  if (a < 100) a += 2000;
  if (d < 1 || d > 31 || mes < 1 || mes > 12) return null;
  return new Date(a, mes - 1, d, 12, 0, 0);
}

function sha256Hex_(s) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
}
function hashClave_(usuario, clave) { return sha256Hex_(String(usuario).trim().toLowerCase() + '|' + clave + '|' + CFG.SAL); }

function siguientes_(clave, n) {
  const p = PropertiesService.getScriptProperties();
  const v = parseInt(p.getProperty(clave) || '0', 10);
  p.setProperty(clave, String(v + n));
  const out = [];
  for (let i = 1; i <= n; i++) out.push(v + i);
  return out;
}
function idPallet_(n) { return 'PL' + String(n).padStart(6, '0'); }
function idMov_(n) { return 'M' + String(n).padStart(7, '0'); }

function letra_(i) { // 0 → A
  let s = '', n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// ============================ MAPEO FILAS ↔ OBJETOS ============================
function filaPallet_(p) {
  return [p.id, p.codigo, p.desc, p.unidad, p.rend, p.cajasIni, p.cajas, p.mts, p.tono, p.calibre, p.acopio, p.ubic,
          p.fIngreso || '', p.uIngreso || '', p.ultMov || '', p.obs || '', p.origen || 'APP'];
}
function palletObj_(r) {
  const I = IX.PALLETS;
  return {
    id: String(r[I.ID]), codigo: String(r[I.CODIGO]), desc: String(r[I.DESCRIPCION]), unidad: String(r[I.UNIDAD] || 'M2'),
    rend: num_(r[I.RENDIMIENTO]), cajasIni: num_(r[I.CAJAS_INI]), cajas: num_(r[I.CAJAS]), mts: num_(r[I.MTS]),
    tono: String(r[I.TONO]), calibre: String(r[I.CALIBRE]), acopio: String(r[I.ACOPIO]), ubic: String(r[I.UBICACION]),
    fIngreso: ms_(r[I.FECHA_INGRESO]), uIngreso: String(r[I.USUARIO_INGRESO]), ultMov: ms_(r[I.ULT_MOV]),
    obs: String(r[I.OBS]), origen: String(r[I.ORIGEN]),
  };
}
function filaMov_(m) {
  return [m.id, m.fecha, m.tipo, m.pallet || '', m.codigo, m.desc || '', m.unidad || '', m.cajas, m.mts, m.tono || '',
          m.calibre || '', m.acoOrig || '', m.ubiOrig || '', m.acoDest || '', m.ubiDest || '', m.destino || '',
          m.detalle || '', m.gruero || '', m.usuario || '', m.obs || '', m.op || ''];
}
function movObj_(r) {
  const I = IX.MOV;
  const op = String(r[I.OP_ID]);
  return {
    id: String(r[I.ID_MOV]), fecha: ms_(r[I.FECHA_HORA]), tipo: String(r[I.TIPO]), pallet: String(r[I.ID_PALLET]),
    codigo: String(r[I.CODIGO]), desc: String(r[I.DESCRIPCION]), unidad: String(r[I.UNIDAD]), cajas: num_(r[I.CAJAS]),
    mts: num_(r[I.MTS]), tono: String(r[I.TONO]), calibre: String(r[I.CALIBRE]), acoOrig: String(r[I.ACOPIO_ORIG]),
    ubiOrig: String(r[I.UBIC_ORIG]), acoDest: String(r[I.ACOPIO_DEST]), ubiDest: String(r[I.UBIC_DEST]),
    destino: String(r[I.DESTINO]), detalle: String(r[I.DETALLE]), gruero: String(r[I.GRUERO]),
    usuario: String(r[I.USUARIO]), obs: String(r[I.OBS]), hist: op.indexOf('MIG-SALIDAS') === 0,
  };
}
function ubicObj_(r) {
  const I = IX.UBIC;
  const cap = r[I.CAPACIDAD] === '' || r[I.CAPACIDAD] === null ? null : num_(r[I.CAPACIDAD]);
  return {
    acopio: String(r[I.ACOPIO]), ubic: String(r[I.UBICACION]), pasillo: String(r[I.PASILLO]), numero: num_(r[I.NUMERO]),
    cap: cap && cap > 0 ? cap : null, tipo: String(r[I.TIPO] || 'POSICION'),
    activa: String(r[I.ACTIVA]).toUpperCase() !== 'NO', obs: String(r[I.OBS]),
  };
}
function filaUbic_(u) {
  return [String(u.acopio), u.ubic, u.pasillo, u.numero, u.cap ? u.cap : '', u.tipo || 'POSICION', u.activa === false ? 'NO' : 'SI', u.obs || ''];
}

// ============================ AUTENTICACIÓN ============================
function secreto_() {
  const p = PropertiesService.getScriptProperties();
  let s = p.getProperty('TOKEN_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('TOKEN_SECRET', s); }
  return s;
}
function firma_(texto) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(texto, secreto_())); }

function crearToken_(usuario) {
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify({ u: usuario, exp: Date.now() + CFG.TOKEN_HORAS * 3600000 }));
  return payload + '.' + firma_(payload);
}

function verificarToken_(token) {
  if (!token || String(token).indexOf('.') < 0) return null;
  const partes = String(token).split('.');
  if (partes.length !== 2 || firma_(partes[0]) !== partes[1]) return null;
  let data;
  try { data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(partes[0])).getDataAsString()); } catch (e) { return null; }
  if (!data || !data.exp || data.exp < Date.now()) return null;
  const u = buscarUsuario_(data.u);
  return u && u.activo ? u : null;
}

function buscarUsuario_(usuario) {
  const objetivo = String(usuario || '').trim().toLowerCase();
  const T = leer_('USR'), I = IX.USR;
  for (let i = 0; i < T.filas.length; i++) {
    const r = T.filas[i];
    if (String(r[I.USUARIO]).trim().toLowerCase() === objetivo) {
      return {
        usuario: objetivo, nombre: String(r[I.NOMBRE] || objetivo), rol: ROLES[String(r[I.ROL])] ? String(r[I.ROL]) : 'CONSULTA',
        activo: String(r[I.ACTIVO]).toUpperCase() !== 'NO', hash: String(r[I.HASH]), fila: i + 2,
      };
    }
  }
  return null;
}

function sesionPublica_(u) { return { usuario: u.usuario, nombre: u.nombre, rol: u.rol }; }

function login_(req) {
  const u = buscarUsuario_(req.usuario);
  if (!u || !req.hash || u.hash !== String(req.hash)) return { ok: false, error: 'Usuario o clave incorrectos.' };
  if (!u.activo) return { ok: false, error: 'Usuario desactivado. Habla con el administrador.' };
  hoja_(HOJA.USR, true).getRange(u.fila, IX.USR.ULT_ACCESO + 1).setValue(new Date());
  return { ok: true, token: crearToken_(u.usuario), usuario: sesionPublica_(u), version: VERSION };
}

// ============================ LECTURAS ============================
function ubicaciones_() {
  return leer_('UBIC').filas.filter(function (r) { return String(r[IX.UBIC.UBICACION]).trim() !== ''; }).map(ubicObj_);
}
function mapaUbic_() {
  const m = {};
  ubicaciones_().forEach(function (u) { m[u.acopio + '|' + u.ubic] = u; });
  return m;
}

/** Ubica la fila de cabecera en las primeras filas: devuelve {fila (1-based), cab: [minúsculas]}. */
function cabecera_(sh, textoClave) {
  const last = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (last < 1 || lastCol < 1) return null;
  const n = Math.min(15, last);
  const vals = sh.getRange(1, 1, n, lastCol).getValues();
  for (let r = 0; r < n; r++) {
    const cab = vals[r].map(function (x) { return String(x).trim().toLowerCase(); });
    if (cab.indexOf(textoClave) >= 0) return { fila: r + 1, cab: cab };
  }
  return null;
}
function idxCab_(cab, opciones, modo) {
  for (let k = 0; k < opciones.length; k++) {
    for (let i = 0; i < cab.length; i++) {
      const c = cab[i];
      if (modo === 'empieza' ? c.indexOf(opciones[k]) === 0 : (modo === 'contiene' ? c.indexOf(opciones[k]) >= 0 : c === opciones[k])) return i;
    }
  }
  return -1;
}

/** Export ERP ('fisico'). Devuelve {CODIGO: [disp, fisico, picking, desc]} (primera coincidencia, igual que el BUSCADOR). */
function leerERP_(codigos) {
  const sh = hoja_(ORIGEN.ERP, false);
  if (!sh) return {};
  const c = cabecera_(sh, 'codigo_tecnico');
  if (!c) return {};
  const ic = c.cab.indexOf('codigo_tecnico'), idsc = idxCab_(c.cab, ['descripcion']), idis = idxCab_(c.cab, ['disp']),
        ibod = idxCab_(c.cab, ['bod']), iub = idxCab_(c.cab, ['ubicacion']);
  const ncol = Math.max(ic, idsc, idis, ibod, iub) + 1;
  const last = sh.getLastRow();
  if (last <= c.fila) return {};
  const datos = sh.getRange(c.fila + 1, 1, last - c.fila, ncol).getValues();
  const out = {};
  for (let i = 0; i < datos.length; i++) {
    const f = datos[i], k = normCodigo_(f[ic]);
    if (!k || out[k] || (codigos && !codigos[k])) continue;
    out[k] = [num_(idis >= 0 ? f[idis] : 0), num_(ibod >= 0 ? f[ibod] : 0), iub >= 0 ? String(f[iub]).trim() : '', idsc >= 0 ? String(f[idsc]).trim() : ''];
  }
  return out;
}

/** Maestro 'TABLA DE CODIGOS': {hoja, filaCab, ic, id, ir} */
function infoMaestro_() {
  const sh = hoja_(ORIGEN.MAESTRO, false);
  if (!sh) return null;
  const c = cabecera_(sh, 'codigo');
  if (!c) return null;
  return { sh: sh, fila: c.fila, ic: c.cab.indexOf('codigo'), id: idxCab_(c.cab, ['descrip'], 'empieza'), ir: idxCab_(c.cab, ['caja'], 'contiene') };
}

function leerMaestro_() {
  const m = infoMaestro_();
  if (!m) return [];
  const last = m.sh.getLastRow();
  if (last <= m.fila) return [];
  const ncol = Math.max(m.ic, m.id, m.ir) + 1;
  return m.sh.getRange(m.fila + 1, 1, last - m.fila, ncol).getValues();
}

function codigosPegamentos_() {
  const sh = hoja_(ORIGEN.PEGAMENTOS, false), out = {};
  if (!sh) return out;
  const c = cabecera_(sh, 'codigo');
  if (!c) return out;
  const ic = c.cab.indexOf('codigo'), last = sh.getLastRow();
  if (last <= c.fila) return out;
  sh.getRange(c.fila + 1, ic + 1, last - c.fila, 1).getValues().forEach(function (r) { const k = normCodigo_(r[0]); if (k) out[k] = true; });
  return out;
}

function unidadDe_(codigo, rend, peg) { return (peg && peg[codigo]) || !(rend > 0) ? 'UN' : 'M2'; }

/** Busca un producto: primero APP_PRODUCTOS, luego el maestro (TextFinder, sin leer las 11k filas). */
function buscarProducto_(codigo) {
  const k = normCodigo_(codigo);
  const P = leer_('PROD'), I = IX.PROD;
  for (let i = 0; i < P.filas.length; i++) {
    if (normCodigo_(P.filas[i][I.CODIGO]) === k) {
      return { codigo: k, desc: String(P.filas[i][I.DESCRIPCION]), rend: num_(P.filas[i][I.RENDIMIENTO]), unidad: String(P.filas[i][I.UNIDAD] || 'M2'), app: true };
    }
  }
  const m = infoMaestro_();
  if (!m) return null;
  const last = m.sh.getLastRow();
  if (last <= m.fila) return null;
  const celda = m.sh.getRange(m.fila + 1, m.ic + 1, last - m.fila, 1).createTextFinder(k).matchEntireCell(true).matchCase(false).findNext();
  if (!celda) return null;
  const f = m.sh.getRange(celda.getRow(), 1, 1, Math.max(m.ic, m.id, m.ir) + 1).getValues()[0];
  const rend = num_(f[m.ir]);
  return { codigo: k, desc: String(f[m.id]).trim(), rend: rend, unidad: unidadDe_(k, rend, codigosPegamentos_()), app: false };
}

function prodVer_() {
  const m = infoMaestro_();
  const p = hoja_(HOJA.PROD, false);
  return (m ? m.sh.getLastRow() : 0) + '-' + (p ? p.getLastRow() : 0) + '-' + (PropertiesService.getScriptProperties().getProperty('PROD_VER') || '0');
}

function grueros_() {
  const set = {};
  leer_('USR').filas.forEach(function (r) {
    const I = IX.USR;
    if (String(r[I.ACTIVO]).toUpperCase() !== 'NO' && ROLES[String(r[I.ROL])] >= ROLES.OPERADOR) set[String(r[I.NOMBRE] || r[I.USUARIO]).trim().toUpperCase()] = 1;
  });
  const sh = hoja_(HOJA.MOV, true), last = sh.getLastRow();
  if (last > 1) {
    const n = Math.min(CFG.FILAS_GRUEROS, last - 1);
    sh.getRange(last - n + 1, IX.MOV.GRUERO + 1, n, 1).getValues().forEach(function (r) {
      const g = String(r[0]).trim().toUpperCase();
      if (g) set[g] = 1;
    });
  }
  return Object.keys(set).sort();
}

function bootstrap_(req, ses) {
  const pallets = leer_('PALLETS').filas.filter(function (r) { return String(r[0]).trim() !== ''; }).map(palletObj_);
  const cods = {};
  pallets.forEach(function (p) { cods[p.codigo] = true; });
  const erpFull = leerERP_(cods), erp = {};
  Object.keys(erpFull).forEach(function (k) { erp[k] = erpFull[k].slice(0, 3); });
  return {
    ok: true, version: VERSION, ahora: Date.now(), usuario: sesionPublica_(ses),
    pallets: pallets, ubicaciones: ubicaciones_(), erp: erp, grueros: grueros_(), prodVer: prodVer_(),
  };
}

function productos_() {
  const peg = codigosPegamentos_();
  const mapa = {};
  const m = infoMaestro_();
  if (m) {
    leerMaestro_().forEach(function (f) {
      const k = normCodigo_(f[m.ic]);
      if (!k || k.charAt(0) === '#') return;
      const rend = num_(f[m.ir]);
      mapa[k] = [k, String(f[m.id] || '').trim(), rend, unidadDe_(k, rend, peg), 0];
    });
  }
  leer_('PROD').filas.forEach(function (f) {
    const I = IX.PROD, k = normCodigo_(f[I.CODIGO]);
    if (k) mapa[k] = [k, String(f[I.DESCRIPCION]), num_(f[I.RENDIMIENTO]), String(f[I.UNIDAD] || 'M2'), 1];
  });
  return { ok: true, ver: prodVer_(), items: Object.keys(mapa).map(function (k) { return mapa[k]; }) };
}

function erpConsulta_(req) {
  const k = normCodigo_(req.codigo);
  if (!k) return { ok: false, error: 'Falta el código' };
  const q = {}; q[k] = true;
  const r = leerERP_(q)[k];
  return { ok: true, codigo: k, encontrado: !!r, erp: r ? r.slice(0, 3) : null, desc: r ? r[3] : '' };
}

function palletInfo_(req) {
  const id = normCodigo_(req.id);
  const act = leer_('PALLETS').filas.filter(function (r) { return String(r[0]) === id; })[0];
  if (act) return { ok: true, activo: true, pallet: palletObj_(act) };
  const sh = hoja_(HOJA.HIST, true), last = sh.getLastRow();
  if (last > 1) {
    const celda = sh.getRange(2, 1, last - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
    if (celda) {
      const r = sh.getRange(celda.getRow(), 1, 1, COL.HIST.length).getValues()[0];
      return { ok: true, activo: false, pallet: palletObj_(r), cierre: { fecha: ms_(r[IX.HIST.FECHA_CIERRE]), motivo: String(r[IX.HIST.MOTIVO_CIERRE]) } };
    }
  }
  return { ok: false, code: 'NO_EXISTE', error: 'El pallet ' + id + ' no existe.' };
}

/** Filas de movimientos entre dos fechas (ms). Lee solo la columna de fecha para acotar el bloque. */
function movsEntre_(desde, hasta) {
  const sh = hoja_(HOJA.MOV, true), last = sh.getLastRow();
  if (last < 2) return [];
  const fechas = sh.getRange(2, IX.MOV.FECHA_HORA + 1, last - 1, 1).getValues();
  let ini = -1, fin = -1;
  for (let i = 0; i < fechas.length; i++) {
    const f = ms_(fechas[i][0]);
    if (f !== null && f >= desde && f <= hasta) { if (ini < 0) ini = i; fin = i; }
  }
  if (ini < 0) return [];
  return sh.getRange(ini + 2, 1, fin - ini + 1, COL.MOV.length).getValues().filter(function (r) {
    const f = ms_(r[IX.MOV.FECHA_HORA]);
    return f !== null && f >= desde && f <= hasta;
  });
}

function movimientos_(req) {
  const hasta = Number(req.hasta) || Date.now();
  const desde = Number(req.desde) || (hasta - 7 * 86400000);
  const tipo = String(req.tipo || '').toUpperCase();
  let filas = movsEntre_(desde, hasta);
  if (tipo) filas = filas.filter(function (r) { return String(r[IX.MOV.TIPO]).indexOf(tipo) === 0; });
  let truncado = false;
  if (filas.length > CFG.MAX_FILAS_CONSULTA) { filas = filas.slice(filas.length - CFG.MAX_FILAS_CONSULTA); truncado = true; }
  return { ok: true, desde: desde, hasta: hasta, truncado: truncado, movs: filas.map(movObj_) };
}

function historial_(req) {
  if (req.id) {
    const id = normCodigo_(req.id);
    const sh = hoja_(HOJA.MOV, true), last = sh.getLastRow();
    if (last < 2) return { ok: true, movs: [] };
    const celdas = sh.getRange(2, IX.MOV.ID_PALLET + 1, last - 1, 1).createTextFinder(id).matchEntireCell(true).findAll();
    const movs = celdas.slice(-200).map(function (c) { return movObj_(sh.getRange(c.getRow(), 1, 1, COL.MOV.length).getValues()[0]); });
    return { ok: true, movs: movs };
  }
  const k = normCodigo_(req.codigo);
  const dias = Math.min(365, Math.max(1, Number(req.dias) || 90));
  const filas = movsEntre_(Date.now() - dias * 86400000, Date.now() + 60000).filter(function (r) { return normCodigo_(r[IX.MOV.CODIGO]) === k; });
  return { ok: true, dias: dias, movs: filas.map(movObj_) };
}

// ============================ ESCRITURAS ============================
function opProcesada_(opId) {
  const sh = hoja_(HOJA.MOV, true), last = sh.getLastRow();
  if (last < 2 || !opId) return null;
  const celdas = sh.getRange(2, IX.MOV.OP_ID + 1, last - 1, 1).createTextFinder(opId).matchEntireCell(true).findAll();
  if (!celdas.length) return null;
  const ids = celdas.map(function (c) { return String(sh.getRange(c.getRow(), IX.MOV.ID_PALLET + 1).getValue()); });
  return { ok: true, duplicado: true, ids: ids, mensaje: 'Esta operación ya estaba registrada.' };
}

function validarUbicDestino_(acopio, ubicRaw, req, ses) {
  if (!/^[12]$/.test(acopio)) throw new Error('Acopio inválido (1 o 2).');
  const ubic = normUbic_(ubicRaw).v;
  if (ubic === 'SIN-UBIC') throw new Error('Indica la ubicación de destino.');
  const U = mapaUbic_();
  let u = U[acopio + '|' + ubic];
  if (!u) {
    if (req.crearUbicacion && ROLES[ses.rol] >= ROLES.SUPERVISOR) {
      const pt = partesUbic_(ubic);
      u = { acopio: acopio, ubic: ubic, pasillo: pt.pasillo, numero: pt.numero, cap: null, tipo: 'POSICION', activa: true, obs: 'Creada desde la app por ' + ses.usuario };
      agregar_('UBIC', [filaUbic_(u)]);
    } else {
      return { error: { ok: false, code: 'UBIC_NO_EXISTE', ubic: ubic, error: 'La ubicación ' + ubic + ' no existe en Acopio ' + acopio + '.' } };
    }
  }
  if (!u.activa) return { error: { ok: false, code: 'UBIC_INACTIVA', error: 'La ubicación ' + ubic + ' está inactiva.' } };
  return { ubic: ubic, u: u };
}

function crearProductoInterno_(codigo, datos, ses) {
  const unidad = String(datos.unidad || 'M2').toUpperCase() === 'UN' ? 'UN' : 'M2';
  const rend = unidad === 'UN' ? 0 : num_(datos.rendimiento);
  const desc = String(datos.descripcion || '').trim();
  if (!desc) throw new Error('Falta la descripción del producto nuevo.');
  if (unidad === 'M2' && !(rend > 0)) throw new Error('Indica los m² por caja del producto nuevo.');
  agregar_('PROD', [[codigo, desc, rend, unidad, new Date(), ses.usuario]]);
  const p = PropertiesService.getScriptProperties();
  p.setProperty('PROD_VER', String(parseInt(p.getProperty('PROD_VER') || '0', 10) + 1));
  return { codigo: codigo, desc: desc, rend: rend, unidad: unidad, app: true };
}

function entrada_(req, ses) {
  const codigo = normCodigo_(req.codigo);
  if (!codigo) throw new Error('Falta el código del producto.');
  const n = Math.floor(num_(req.pallets) || 1);
  if (n < 1 || n > CFG.MAX_PALLETS_POR_ENTRADA) throw new Error('Cantidad de pallets inválida (1 a ' + CFG.MAX_PALLETS_POR_ENTRADA + ').');
  const cajas = num_(req.cajas);
  if (!(cajas > 0)) throw new Error('Las cajas por pallet deben ser mayores a 0.');
  const acopio = String(req.acopio || '');

  let prod = buscarProducto_(codigo);
  if (!prod) {
    if (!req.producto || !req.producto.descripcion) return { ok: false, code: 'PRODUCTO_NUEVO', error: 'El código ' + codigo + ' no existe en el maestro.' };
    prod = crearProductoInterno_(codigo, req.producto, ses);
  }

  const dest = validarUbicDestino_(acopio, req.ubicacion, req, ses);
  if (dest.error) return dest.error;
  const ubic = dest.ubic;

  const T = leer_('PALLETS'), I = IX.PALLETS;
  const ocupados = T.filas.filter(function (r) { return String(r[I.ACOPIO]) === acopio && String(r[I.UBICACION]) === ubic; }).length;
  const cap = dest.u.cap;
  if (cap && ocupados + n > cap && !req.forzar) {
    return { ok: false, code: 'CAPACIDAD', ocupados: ocupados, capacidad: cap, error: ubic + ' tiene ' + ocupados + '/' + cap + ' pallets: no caben ' + n + ' más.' };
  }

  const ahora = new Date();
  const ids = siguientes_('SEQ_PALLET', n).map(idPallet_);
  const movIds = siguientes_('SEQ_MOV', n).map(idMov_);
  const tono = normTxt_(req.tono), calibre = normTxt_(req.calibre);
  const rend = prod.unidad === 'UN' ? 0 : prod.rend;
  const mts = r4_(cajas * rend);
  const gruero = String(req.gruero || ses.nombre).trim().toUpperCase();
  const obs = String(req.obs || '').trim(), detalle = String(req.detalle || '').trim();
  const filasP = [], filasM = [];
  ids.forEach(function (id, k) {
    filasP.push(filaPallet_({ id: id, codigo: codigo, desc: prod.desc, unidad: prod.unidad, rend: rend, cajasIni: cajas, cajas: cajas, mts: mts,
      tono: tono, calibre: calibre, acopio: acopio, ubic: ubic, fIngreso: ahora, uIngreso: ses.usuario, ultMov: ahora, obs: obs, origen: 'APP' }));
    filasM.push(filaMov_({ id: movIds[k], fecha: ahora, tipo: 'ENTRADA', pallet: id, codigo: codigo, desc: prod.desc, unidad: prod.unidad,
      cajas: cajas, mts: mts, tono: tono, calibre: calibre, acoDest: acopio, ubiDest: ubic, detalle: detalle, gruero: gruero,
      usuario: ses.usuario, obs: obs, op: String(req.opId || '') }));
  });
  agregar_('PALLETS', filasP);
  agregar_('MOV', filasM);
  return { ok: true, ids: ids, pallets: filasP.map(palletObj_), fecha: ahora.getTime(), excedida: !!(cap && ocupados + n > cap), producto: prod };
}

function salida_(req, ses) {
  const items = Array.isArray(req.items) ? req.items : [];
  if (!items.length) throw new Error('No hay pallets en la salida.');
  if (items.length > CFG.MAX_ITEMS_POR_LOTE) throw new Error('Máximo ' + CFG.MAX_ITEMS_POR_LOTE + ' pallets por salida.');
  const destino = DESTINOS.indexOf(String(req.destino || '').toUpperCase()) >= 0 ? String(req.destino).toUpperCase() : 'PICKING';

  const T = leer_('PALLETS'), I = IX.PALLETS;
  const pos = {};
  T.filas.forEach(function (r, i) { pos[String(r[I.ID])] = i; });
  const vistos = {}, errores = [];
  const plan = [];
  items.forEach(function (it) {
    const id = normCodigo_(it.id);
    if (vistos[id]) { errores.push(id + ': repetido en el lote'); return; }
    vistos[id] = true;
    const i = pos[id];
    if (i === undefined) { errores.push(id + ': no está en acopio (¿ya salió?)'); return; }
    const r = T.filas[i], disp = num_(r[I.CAJAS]);
    const cs = (it.cajas === null || it.cajas === undefined || it.cajas === '') ? disp : num_(it.cajas);
    if (!(cs > 0)) { errores.push(id + ': cantidad inválida'); return; }
    if (cs > disp + 1e-9) { errores.push(id + ': pide ' + cs + ' y quedan ' + disp); return; }
    plan.push({ i: i, r: r, cs: cs, total: cs >= disp - 1e-9, detalle: String(it.detalle || req.detalle || '').trim() });
  });
  if (errores.length) return { ok: false, code: 'VALIDACION', error: errores.join(' · ') };

  const ahora = new Date();
  const movIds = siguientes_('SEQ_MOV', plan.length);
  const gruero = String(req.gruero || ses.nombre).trim().toUpperCase();
  const obs = String(req.obs || '').trim();
  const filasM = [], cerrar = [], parciales = [];
  plan.forEach(function (p, k) {
    const r = p.r, rend = num_(r[I.RENDIMIENTO]);
    filasM.push(filaMov_({ id: idMov_(movIds[k]), fecha: ahora, tipo: p.total ? 'SALIDA' : 'SALIDA_PARCIAL', pallet: r[I.ID], codigo: r[I.CODIGO],
      desc: r[I.DESCRIPCION], unidad: r[I.UNIDAD], cajas: p.cs, mts: r4_(p.cs * rend), tono: r[I.TONO], calibre: r[I.CALIBRE],
      acoOrig: r[I.ACOPIO], ubiOrig: r[I.UBICACION], destino: destino, detalle: p.detalle, gruero: gruero, usuario: ses.usuario,
      obs: obs, op: String(req.opId || '') }));
    if (p.total) {
      cerrar.push(p);
    } else {
      r[I.CAJAS] = r4_(num_(r[I.CAJAS]) - p.cs);
      r[I.MTS] = r4_(r[I.CAJAS] * rend);
      r[I.ULT_MOV] = ahora;
      parciales.push(p);
    }
  });

  // 1) actualizar parciales (índices aún válidos)  2) mover cerrados a HIST y borrarlos
  parciales.forEach(function (p) { T.sh.getRange(p.i + 2, 1, 1, COL.PALLETS.length).setValues([p.r]); });
  if (cerrar.length) {
    agregar_('HIST', cerrar.map(function (p) { const r = p.r.slice(); r[I.ULT_MOV] = ahora; return r.concat([ahora, 'SALIDA ' + destino]); }));
    borrarFilas_(T.sh, cerrar.map(function (p) { return p.i + 2; }));
  }
  agregar_('MOV', filasM);

  const cerradosIdx = {};
  cerrar.forEach(function (p) { cerradosIdx[p.i] = true; });
  const liberadas = posicionesLiberadas_(T.filas, cerradosIdx, cerrar.map(function (p) { return p.r; }));
  return {
    ok: true, fecha: ahora.getTime(), movs: filasM.length,
    cerrados: cerrar.map(function (p) { return String(p.r[I.ID]); }),
    pallets: parciales.map(function (p) { return palletObj_(p.r); }),
    liberadas: liberadas,
  };
}

/** Devuelve [{acopio, ubic}] de las posiciones que quedaron sin pallets. */
function posicionesLiberadas_(filas, excluidosIdx, origenes) {
  const I = IX.PALLETS, cuenta = {};
  filas.forEach(function (r, i) {
    if (excluidosIdx[i]) return;
    const k = String(r[I.ACOPIO]) + '|' + String(r[I.UBICACION]);
    cuenta[k] = (cuenta[k] || 0) + 1;
  });
  const out = {}, lista = [];
  origenes.forEach(function (r) {
    const k = String(r[I.ACOPIO]) + '|' + String(r[I.UBICACION]);
    if (!cuenta[k] && !out[k]) { out[k] = true; lista.push({ acopio: String(r[I.ACOPIO]), ubic: String(r[I.UBICACION]) }); }
  });
  return lista;
}

function traslado_(req, ses) {
  const ids = (Array.isArray(req.ids) ? req.ids : []).map(normCodigo_).filter(String);
  if (!ids.length) throw new Error('No hay pallets para trasladar.');
  const acopio = String(req.acopio || '');
  const dest = validarUbicDestino_(acopio, req.ubicacion, req, ses);
  if (dest.error) return dest.error;
  const ubic = dest.ubic;

  const T = leer_('PALLETS'), I = IX.PALLETS;
  const pos = {};
  T.filas.forEach(function (r, i) { pos[String(r[I.ID])] = i; });
  const faltan = ids.filter(function (id) { return pos[id] === undefined; });
  if (faltan.length) return { ok: false, code: 'VALIDACION', error: 'No están en acopio: ' + faltan.join(', ') };

  const mover = ids.filter(function (id) {
    const r = T.filas[pos[id]];
    return !(String(r[I.ACOPIO]) === acopio && String(r[I.UBICACION]) === ubic);
  });
  if (!mover.length) return { ok: false, code: 'VALIDACION', error: 'Los pallets ya están en ' + ubic + '.' };

  const ocupados = T.filas.filter(function (r) { return String(r[I.ACOPIO]) === acopio && String(r[I.UBICACION]) === ubic; }).length;
  const cap = dest.u.cap;
  if (cap && ocupados + mover.length > cap && !req.forzar) {
    return { ok: false, code: 'CAPACIDAD', ocupados: ocupados, capacidad: cap, error: ubic + ' tiene ' + ocupados + '/' + cap + ' pallets: no caben ' + mover.length + ' más.' };
  }

  const ahora = new Date();
  const movIds = siguientes_('SEQ_MOV', mover.length);
  const gruero = String(req.gruero || ses.nombre).trim().toUpperCase();
  const obs = String(req.obs || '').trim();
  const filasM = [], origenes = [], actualizados = [];
  mover.forEach(function (id, k) {
    const i = pos[id], r = T.filas[i];
    origenes.push(r.slice());
    filasM.push(filaMov_({ id: idMov_(movIds[k]), fecha: ahora, tipo: 'TRASLADO', pallet: id, codigo: r[I.CODIGO], desc: r[I.DESCRIPCION],
      unidad: r[I.UNIDAD], cajas: num_(r[I.CAJAS]), mts: num_(r[I.MTS]), tono: r[I.TONO], calibre: r[I.CALIBRE], acoOrig: r[I.ACOPIO],
      ubiOrig: r[I.UBICACION], acoDest: acopio, ubiDest: ubic, gruero: gruero, usuario: ses.usuario, obs: obs, op: String(req.opId || '') }));
    r[I.ACOPIO] = acopio; r[I.UBICACION] = ubic; r[I.ULT_MOV] = ahora;
    T.sh.getRange(i + 2, 1, 1, COL.PALLETS.length).setValues([r]);
    actualizados.push(palletObj_(r));
  });
  agregar_('MOV', filasM);
  return { ok: true, fecha: ahora.getTime(), pallets: actualizados, liberadas: posicionesLiberadas_(T.filas, {}, origenes), excedida: !!(cap && ocupados + mover.length > cap) };
}

function ajuste_(req, ses) {
  const id = normCodigo_(req.id);
  const motivo = String(req.motivo || '').trim();
  if (!motivo) throw new Error('Indica el motivo del ajuste.');
  const T = leer_('PALLETS'), I = IX.PALLETS;
  const i = T.filas.findIndex(function (r) { return String(r[I.ID]) === id; });
  if (i < 0) return { ok: false, code: 'NO_EXISTE', error: 'El pallet ' + id + ' no está en acopio.' };
  const r = T.filas[i], antes = num_(r[I.CAJAS]), rend = num_(r[I.RENDIMIENTO]);
  const nuevas = (req.cajas === undefined || req.cajas === null || req.cajas === '') ? antes : num_(req.cajas);
  if (nuevas < 0) throw new Error('Las cajas no pueden ser negativas.');
  const cambios = [];
  if (nuevas !== antes) cambios.push('cajas ' + antes + '→' + nuevas);
  if (req.tono !== undefined && normTxt_(req.tono) !== String(r[I.TONO])) { cambios.push('tono ' + (r[I.TONO] || '—') + '→' + (normTxt_(req.tono) || '—')); r[I.TONO] = normTxt_(req.tono); }
  if (req.calibre !== undefined && normTxt_(req.calibre) !== String(r[I.CALIBRE])) { cambios.push('calibre ' + (r[I.CALIBRE] || '—') + '→' + (normTxt_(req.calibre) || '—')); r[I.CALIBRE] = normTxt_(req.calibre); }
  if (!cambios.length) return { ok: false, code: 'VALIDACION', error: 'No hay cambios que registrar.' };

  const ahora = new Date();
  const mid = idMov_(siguientes_('SEQ_MOV', 1)[0]);
  const delta = r4_(nuevas - antes);
  agregar_('MOV', [filaMov_({ id: mid, fecha: ahora, tipo: 'AJUSTE', pallet: id, codigo: r[I.CODIGO], desc: r[I.DESCRIPCION], unidad: r[I.UNIDAD],
    cajas: delta, mts: r4_(delta * rend), tono: r[I.TONO], calibre: r[I.CALIBRE], acoOrig: r[I.ACOPIO], ubiOrig: r[I.UBICACION],
    acoDest: r[I.ACOPIO], ubiDest: r[I.UBICACION], gruero: '', usuario: ses.usuario, obs: motivo + ' (' + cambios.join(', ') + ')', op: String(req.opId || '') })]);

  r[I.CAJAS] = r4_(nuevas); r[I.MTS] = r4_(nuevas * rend); r[I.ULT_MOV] = ahora;
  if (nuevas === 0) {
    agregar_('HIST', [r.concat([ahora, 'AJUSTE: ' + motivo])]);
    T.sh.deleteRow(i + 2);
    const libres = {}; libres[i] = true;
    return { ok: true, fecha: ahora.getTime(), cerrados: [id], pallets: [], liberadas: posicionesLiberadas_(T.filas, libres, [r]) };
  }
  T.sh.getRange(i + 2, 1, 1, COL.PALLETS.length).setValues([r]);
  return { ok: true, fecha: ahora.getTime(), cerrados: [], pallets: [palletObj_(r)], liberadas: [] };
}

function crearProducto_(req, ses) {
  const codigo = normCodigo_(req.codigo);
  if (!codigo) throw new Error('Falta el código.');
  const existe = buscarProducto_(codigo);
  if (existe && !existe.app) return { ok: false, code: 'EXISTE', error: 'El código ' + codigo + ' ya existe en el maestro: ' + existe.desc };
  if (existe && existe.app) {
    const T = leer_('PROD'), I = IX.PROD;
    const i = T.filas.findIndex(function (r) { return normCodigo_(r[I.CODIGO]) === codigo; });
    const unidad = String(req.unidad || 'M2').toUpperCase() === 'UN' ? 'UN' : 'M2';
    T.sh.getRange(i + 2, 1, 1, 4).setValues([[codigo, String(req.descripcion || existe.desc).trim(), unidad === 'UN' ? 0 : num_(req.rendimiento), unidad]]);
    const p = PropertiesService.getScriptProperties();
    p.setProperty('PROD_VER', String(parseInt(p.getProperty('PROD_VER') || '0', 10) + 1));
    return { ok: true, producto: buscarProducto_(codigo), actualizado: true };
  }
  return { ok: true, producto: crearProductoInterno_(codigo, req, ses) };
}

function guardarUbicacion_(req, ses) {
  const acopio = String(req.acopio || '');
  if (!/^[12]$/.test(acopio)) throw new Error('Acopio inválido.');
  const ubic = normUbic_(req.ubic).v;
  if (ubic === 'SIN-UBIC') throw new Error('Falta la ubicación.');
  const T = leer_('UBIC'), I = IX.UBIC;
  const i = T.filas.findIndex(function (r) { return String(r[I.ACOPIO]) === acopio && String(r[I.UBICACION]) === ubic; });
  const cap = req.cap === '' || req.cap === null || req.cap === undefined ? null : Math.floor(num_(req.cap));
  const tipo = TIPOS_UBIC.indexOf(String(req.tipo || '').toUpperCase()) >= 0 ? String(req.tipo).toUpperCase() : 'POSICION';
  const activa = req.activa !== false;
  if (!activa) {
    const ocup = leer_('PALLETS').filas.filter(function (r) { return String(r[IX.PALLETS.ACOPIO]) === acopio && String(r[IX.PALLETS.UBICACION]) === ubic; }).length;
    if (ocup) return { ok: false, code: 'VALIDACION', error: 'No se puede desactivar: ' + ubic + ' tiene ' + ocup + ' pallets.' };
  }
  const pt = partesUbic_(ubic);
  const u = { acopio: acopio, ubic: ubic, pasillo: pt.pasillo, numero: pt.numero, cap: cap, tipo: tipo, activa: activa, obs: String(req.obs || '').trim() };
  if (i >= 0) T.sh.getRange(i + 2, 1, 1, COL.UBIC.length).setValues([filaUbic_(u)]);
  else agregar_('UBIC', [filaUbic_(u)]);
  return { ok: true, ubicacion: ubicObj_(filaUbic_(u)), nueva: i < 0 };
}

function capacidadMasiva_(req) {
  const acopio = String(req.acopio || ''), pasillo = String(req.pasillo || '').trim().toUpperCase();
  const cap = req.cap === '' || req.cap === null || req.cap === undefined ? '' : Math.floor(num_(req.cap));
  if (!/^[12]$/.test(acopio) || !pasillo) throw new Error('Indica acopio y pasillo.');
  const T = leer_('UBIC'), I = IX.UBIC;
  if (!T.filas.length) return { ok: true, actualizadas: 0 };
  let n = 0;
  const colCap = T.filas.map(function (r) {
    const aplica = String(r[I.ACOPIO]) === acopio && String(r[I.PASILLO]) === pasillo && String(r[I.TIPO]) === 'POSICION' &&
                   (!req.soloSinCapacidad || r[I.CAPACIDAD] === '' || r[I.CAPACIDAD] === null);
    if (aplica) { n++; return [cap === 0 ? '' : cap]; }
    return [r[I.CAPACIDAD]];
  });
  T.sh.getRange(2, I.CAPACIDAD + 1, colCap.length, 1).setValues(colCap);
  return { ok: true, actualizadas: n, ubicaciones: ubicaciones_() };
}

function crearRango_(req, ses) {
  const acopio = String(req.acopio || ''), pasillo = String(req.pasillo || '').trim().toUpperCase();
  const desde = Math.floor(num_(req.desde)), hasta = Math.floor(num_(req.hasta));
  if (!/^[12]$/.test(acopio) || !/^[A-Z]$/.test(pasillo)) throw new Error('Acopio o pasillo inválido (pasillo = una letra).');
  if (desde < 0 || hasta < desde || hasta - desde > 200) throw new Error('Rango inválido.');
  const cap = req.cap ? Math.floor(num_(req.cap)) : null;
  const tipo = TIPOS_UBIC.indexOf(String(req.tipo || '').toUpperCase()) >= 0 ? String(req.tipo).toUpperCase() : 'POSICION';
  const U = mapaUbic_(), nuevas = [];
  for (let n = desde; n <= hasta; n++) {
    const ubic = pasillo + '-' + String(n).padStart(2, '0');
    if (U[acopio + '|' + ubic]) continue;
    nuevas.push(filaUbic_({ acopio: acopio, ubic: ubic, pasillo: pasillo, numero: n, cap: cap, tipo: tipo, activa: true, obs: 'Creada por ' + ses.usuario }));
  }
  agregar_('UBIC', nuevas);
  return { ok: true, creadas: nuevas.length, ubicaciones: ubicaciones_() };
}

function usuarios_() {
  const I = IX.USR;
  return {
    ok: true,
    usuarios: leer_('USR').filas.filter(function (r) { return String(r[I.USUARIO]).trim(); }).map(function (r) {
      return { usuario: String(r[I.USUARIO]).trim().toLowerCase(), nombre: String(r[I.NOMBRE]), rol: String(r[I.ROL]),
               activo: String(r[I.ACTIVO]).toUpperCase() !== 'NO', creado: ms_(r[I.CREADO]), ultAcceso: ms_(r[I.ULT_ACCESO]) };
    }),
  };
}

function guardarUsuario_(req, ses) {
  const usuario = String(req.usuario || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) throw new Error('Usuario inválido: 3 a 30 caracteres (letras, números, punto, guion).');
  const rol = ROLES[String(req.rol || '').toUpperCase()] ? String(req.rol).toUpperCase() : 'OPERADOR';
  const activo = req.activo !== false;
  const T = leer_('USR'), I = IX.USR;
  const i = T.filas.findIndex(function (r) { return String(r[I.USUARIO]).trim().toLowerCase() === usuario; });
  if (usuario === ses.usuario && (rol !== 'ADMIN' || !activo)) throw new Error('No puedes quitarte el rol ADMIN ni desactivarte a ti mismo.');
  if (i < 0) {
    if (!req.hash) throw new Error('Define una clave para el usuario nuevo.');
    agregar_('USR', [[usuario, String(req.nombre || usuario).trim(), String(req.hash), rol, activo ? 'SI' : 'NO', new Date(), '']]);
    return { ok: true, nuevo: true };
  }
  const r = T.filas[i];
  r[I.NOMBRE] = String(req.nombre || r[I.NOMBRE]).trim();
  r[I.ROL] = rol;
  r[I.ACTIVO] = activo ? 'SI' : 'NO';
  if (req.hash) r[I.HASH] = String(req.hash);
  T.sh.getRange(i + 2, 1, 1, COL.USR.length).setValues([r]);
  return { ok: true, nuevo: false };
}

function cambiarClave_(req, ses) {
  const u = buscarUsuario_(ses.usuario);
  if (!u || u.hash !== String(req.hashActual || '')) return { ok: false, error: 'La clave actual no es correcta.' };
  if (!req.hashNuevo || String(req.hashNuevo).length !== 64) throw new Error('Clave nueva inválida.');
  hoja_(HOJA.USR, true).getRange(u.fila, IX.USR.HASH + 1).setValue(String(req.hashNuevo));
  return { ok: true };
}

// ============================ SETUP ============================
/** Crea (o completa) las pestañas APP_*, el usuario admin y la vista de salidas. Se puede ejecutar varias veces. */
function setup() {
  const ss = ss_();
  Object.keys(HOJA).forEach(function (k) {
    if (k === 'SALIDAS') return;
    let sh = hoja_(HOJA[k], false);
    if (!sh) { sh = ss.insertSheet(HOJA[k]); _hojas = null; }
    const cols = COL[k];
    if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#356854').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    formatearFilas_(k, sh, 2, Math.max(1, sh.getMaxRows() - 1));
  });
  _hojas = null;

  // Vista "planilla de salida" con fecha y hora (se actualiza sola)
  let vs = hoja_(HOJA.SALIDAS, false);
  if (!vs) { vs = ss.insertSheet(HOJA.SALIDAS); _hojas = null; }
  const L = function (h) { return letra_(IX.MOV[h]); };
  const sel = ['FECHA_HORA', 'CODIGO', 'DESCRIPCION', 'CAJAS', 'MTS', 'TONO', 'CALIBRE', 'ACOPIO_ORIG', 'UBIC_ORIG', 'DESTINO', 'DETALLE', 'GRUERO', 'USUARIO', 'TIPO', 'ID_PALLET', 'OBS'].map(L).join(',');
  const rango = HOJA.MOV + '!A:' + letra_(COL.MOV.length - 1);
  vs.getRange(1, 1).setFormula('=QUERY(' + rango + ',"select ' + sel + ' where ' + L('TIPO') + " starts with 'SALIDA' order by " + L('FECHA_HORA') + ' desc",1)');
  vs.getRange('A:A').setNumberFormat('dd-mm-yyyy hh:mm:ss');
  vs.setFrozenRows(1);

  secreto_();
  const T = leer_('USR');
  if (!T.filas.some(function (r) { return String(r[IX.USR.ROL]) === 'ADMIN'; })) {
    agregar_('USR', [[CFG.ADMIN_USUARIO, CFG.ADMIN_NOMBRE, hashClave_(CFG.ADMIN_USUARIO, CFG.ADMIN_CLAVE_INICIAL), 'ADMIN', 'SI', new Date(), '']]);
    Logger.log('Usuario admin creado: ' + CFG.ADMIN_USUARIO + ' (clave = ADMIN_CLAVE_INICIAL). Cámbiala al primer ingreso.');
  }
  recalcularCorrelativos();
  Logger.log('Setup OK · versión ' + VERSION);
  return 'OK';
}

/** Ajusta los correlativos al máximo existente (por si se pierden las propiedades del script). */
function recalcularCorrelativos() {
  const p = PropertiesService.getScriptProperties();
  let maxP = 0, maxM = 0;
  ['PALLETS', 'HIST'].forEach(function (k) {
    leer_(k).filas.forEach(function (r) { const m = String(r[0]).match(/^PL(\d+)$/); if (m) maxP = Math.max(maxP, parseInt(m[1], 10)); });
  });
  const sh = hoja_(HOJA.MOV, true), last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) { const m = String(r[0]).match(/^M(\d+)$/); if (m) maxM = Math.max(maxM, parseInt(m[1], 10)); });
  p.setProperty('SEQ_PALLET', String(Math.max(maxP, parseInt(p.getProperty('SEQ_PALLET') || '0', 10))));
  p.setProperty('SEQ_MOV', String(Math.max(maxM, parseInt(p.getProperty('SEQ_MOV') || '0', 10))));
}

// ============================ MIGRACIÓN INICIAL ============================
/** Lee una tabla de origen: busca la cabecera que contiene 'codigo' y devuelve {fila, cab, datos}. */
function tablaOrigen_(nombre) {
  const sh = hoja_(nombre, false);
  if (!sh) return null;
  const c = cabecera_(sh, 'codigo');
  if (!c) return null;
  const last = sh.getLastRow();
  const datos = last > c.fila ? sh.getRange(c.fila + 1, 1, last - c.fila, c.cab.length).getValues() : [];
  return { fila: c.fila, cab: c.cab, datos: datos };
}

/**
 * Migra UNA VEZ el contenido actual de 'acopio 1', 'acopio 2', 'PEGAMENTOS' y 'SALIDAS' a las pestañas APP_*.
 * No modifica las hojas originales. Todo lo corregido o descartado queda en APP_LOG_MIGRACION.
 */
function migrarDatosIniciales() {
  setup();
  if (leer_('PALLETS').filas.length || leer_('MOV').filas.length) {
    throw new Error('APP_PALLETS o APP_MOVIMIENTOS ya tienen datos. Para re-migrar, borra sus filas (deja la cabecera) y también las de APP_UBICACIONES y APP_PALLETS_HIST.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ahora = new Date();
    const log = [];
    const anotar = function (origen, fila, campo, orig, nuevo, nota) { log.push([ahora, origen, fila, campo, String(orig), String(nuevo), nota]); };

    // Maestro en memoria (para descripciones y rendimientos faltantes)
    const maestro = {};
    const mi = infoMaestro_();
    if (mi) leerMaestro_().forEach(function (f) { const k = normCodigo_(f[mi.ic]); if (k) maestro[k] = { desc: String(f[mi.id] || '').trim(), rend: num_(f[mi.ir]) }; });

    const pallets = [];
    const codigosAcopio = {};

    // ---- 1) acopio 1 y acopio 2: una fila = un pallet
    ['1', '2'].forEach(function (a) {
      const nombre = ORIGEN.ACOPIO[a];
      const t = tablaOrigen_(nombre);
      if (!t) { anotar(nombre, '', '', '', '', 'Hoja o cabecera no encontrada: no se migró'); return; }
      const c = {
        cod: t.cab.indexOf('codigo'), desc: idxCab_(t.cab, ['descripcion']), rend: idxCab_(t.cab, ['rendimiento']),
        caj: idxCab_(t.cab, ['cajas']), tono: idxCab_(t.cab, ['tono']), cal: idxCab_(t.cab, ['calibre']),
        ub: idxCab_(t.cab, ['ubicacion']), pick: idxCab_(t.cab, ['picking', 'pinking']), fec: idxCab_(t.cab, ['fecha ingreso', 'fecha']),
      };
      t.datos.forEach(function (f, j) {
        const fila = t.fila + 1 + j;
        const cod = normCodigo_(f[c.cod]);
        if (!cod || cod.charAt(0) === '#' || cod === 'SIN REGISTRO') return;
        const m = maestro[cod] || {};
        let desc = c.desc >= 0 ? String(f[c.desc] || '').trim() : '';
        if (!desc || desc.charAt(0) === '#') { anotar(nombre, fila, 'DESCRIPCION', desc, m.desc || '', 'Descripción tomada del maestro'); desc = m.desc || ''; }
        let rend = c.rend >= 0 ? num_(f[c.rend]) : 0;
        if (!(rend > 0) && m.rend > 0) { anotar(nombre, fila, 'RENDIMIENTO', f[c.rend], m.rend, 'Rendimiento tomado del maestro'); rend = m.rend; }
        const cajas = c.caj >= 0 ? num_(f[c.caj]) : 0;
        if (!(cajas > 0)) { anotar(nombre, fila, 'CAJAS', f[c.caj], '', 'Fila OMITIDA: sin cajas. Ingresar manualmente si el pallet existe.'); return; }
        const u = normUbic_(c.ub >= 0 ? f[c.ub] : '');
        if (u.nota) anotar(nombre, fila, 'UBICACION', f[c.ub], u.v, u.nota);
        if (c.pick >= 0) {
          const pk = String(f[c.pick] || '').trim().toUpperCase();
          if (/^S[A-Z]DO\d/.test(pk)) anotar(nombre, fila, 'PICKING', pk, '', 'Ubicación de picking con letra O en vez de cero (viene del ERP)');
          if (pk === 'NO REGISTRA') anotar(nombre, fila, 'PICKING', pk, '', 'Código sin registro en el ERP (fisico)');
        }
        const fi = c.fec >= 0 ? fecha_(f[c.fec]) : null;
        const unidad = rend > 0 ? 'M2' : 'UN';
        codigosAcopio[cod] = nombre;
        pallets.push({ codigo: cod, desc: desc, unidad: unidad, rend: unidad === 'UN' ? 0 : rend, cajasIni: cajas, cajas: cajas,
          mts: r4_(cajas * (unidad === 'UN' ? 0 : rend)), tono: normTxt_(c.tono >= 0 ? f[c.tono] : ''), calibre: normTxt_(c.cal >= 0 ? f[c.cal] : ''),
          acopio: a, ubic: u.v, fIngreso: fi, uIngreso: 'migracion', ultMov: ahora, obs: '', origen: 'MIGRACION' });
      });
    });

    // ---- 2) PEGAMENTOS: conteo de pallets por acopio → N pallets de UND X PALTS sacos, en zona PEGAMENTOS
    let pegPallets = 0;
    const tp = tablaOrigen_(ORIGEN.PEGAMENTOS);
    if (tp) {
      const c = { cod: tp.cab.indexOf('codigo'), desc: idxCab_(tp.cab, ['descripcion']), a1: idxCab_(tp.cab, ['acopio 01', 'acopio 1']),
                  a2: idxCab_(tp.cab, ['acopio 02', 'acopio 2']), flete: idxCab_(tp.cab, ['flete']), und: idxCab_(tp.cab, ['und x palts', 'und x pallet'], 'empieza') };
      tp.datos.forEach(function (f, j) {
        const fila = tp.fila + 1 + j;
        const cod = normCodigo_(f[c.cod]);
        if (!cod || cod.charAt(0) === '#') return;
        const und = c.und >= 0 ? num_(f[c.und]) : 0;
        let desc = c.desc >= 0 ? String(f[c.desc] || '').trim() : '';
        if (!desc || desc.charAt(0) === '#') desc = (maestro[cod] || {}).desc || '';
        if (codigosAcopio[cod]) anotar('PEGAMENTOS', fila, 'CODIGO', cod, '', 'El código también aparece en ' + codigosAcopio[cod] + ': revisar doble conteo');
        const fl = c.flete >= 0 ? Math.round(num_(f[c.flete])) : 0;
        if (fl > 0) anotar('PEGAMENTOS', fila, 'FLETE', fl, '', 'Pallets en FLETE no migrados (no están en acopio)');
        [['1', c.a1], ['2', c.a2]].forEach(function (par) {
          const n = par[1] >= 0 ? Math.round(num_(f[par[1]])) : 0;
          if (n <= 0) return;
          if (!(und > 0)) { anotar('PEGAMENTOS', fila, 'UND X PALTS', f[c.und], '', 'OMITIDO: ' + n + ' pallets sin unidades por pallet'); return; }
          for (let k = 0; k < n; k++) {
            pallets.push({ codigo: cod, desc: desc, unidad: 'UN', rend: 0, cajasIni: und, cajas: und, mts: 0, tono: '', calibre: '',
              acopio: par[0], ubic: 'PEGAMENTOS', fIngreso: null, uIngreso: 'migracion', ultMov: ahora,
              obs: 'Migrado desde PEGAMENTOS: asignar ubicación real con un traslado', origen: 'MIGRACION' });
            pegPallets++;
          }
        });
      });
    } else {
      anotar('PEGAMENTOS', '', '', '', '', 'Hoja o cabecera no encontrada: no se migró');
    }

    // ---- 3) IDs, filas de pallets y movimiento SALDO_INICIAL
    const ids = siguientes_('SEQ_PALLET', pallets.length);
    const filasP = [], filasM = [];
    let seqMov = siguientes_('SEQ_MOV', pallets.length);
    pallets.forEach(function (p, k) {
      p.id = idPallet_(ids[k]);
      filasP.push(filaPallet_(p));
      filasM.push(filaMov_({ id: idMov_(seqMov[k]), fecha: ahora, tipo: 'SALDO_INICIAL', pallet: p.id, codigo: p.codigo, desc: p.desc,
        unidad: p.unidad, cajas: p.cajas, mts: p.mts, tono: p.tono, calibre: p.calibre, acoDest: p.acopio, ubiDest: p.ubic,
        usuario: 'migracion', obs: 'Saldo inicial migrado desde la planilla', op: 'MIG-INICIAL' }));
    });

    // ---- 4) Historial de SALIDAS (sin hora → 12:00, marcado como histórico)
    const histSal = [];
    const ts = tablaOrigen_(ORIGEN.SALIDAS);
    if (ts) {
      const c = { cod: ts.cab.indexOf('codigo'), desc: idxCab_(ts.cab, ['descripcion']), rend: idxCab_(ts.cab, ['rendimiento']), mts: idxCab_(ts.cab, ['mts']),
                  caj: idxCab_(ts.cab, ['cajas']), tono: idxCab_(ts.cab, ['tono']), cal: idxCab_(ts.cab, ['calibre']), ub: idxCab_(ts.cab, ['ubicacion']),
                  sec: idxCab_(ts.cab, ['sector']), gru: idxCab_(ts.cab, ['gruero']), fec: idxCab_(ts.cab, ['fecha']) };
      ts.datos.forEach(function (f, j) {
        const fila = ts.fila + 1 + j;
        const cod = normCodigo_(f[c.cod]);
        if (!cod || cod.charAt(0) === '#') return;
        const fe = fecha_(c.fec >= 0 ? f[c.fec] : '');
        if (!fe) { anotar('SALIDAS', fila, 'FECHA', c.fec >= 0 ? f[c.fec] : '', '', 'OMITIDA: salida sin fecha válida'); return; }
        const rend = (c.rend >= 0 ? num_(f[c.rend]) : 0) || (maestro[cod] || {}).rend || 0;
        const cajas = c.caj >= 0 ? num_(f[c.caj]) : 0;
        const sector = c.sec >= 0 ? String(f[c.sec] || '').trim().toUpperCase() : '';
        const u = normUbic_(c.ub >= 0 ? f[c.ub] : '');
        histSal.push({ fecha: fe, tipo: 'SALIDA', pallet: '', codigo: cod, desc: c.desc >= 0 ? String(f[c.desc] || '').trim() : '', unidad: rend > 0 ? 'M2' : 'UN',
          cajas: cajas, mts: (c.mts >= 0 ? num_(f[c.mts]) : 0) || r4_(cajas * rend), tono: normTxt_(c.tono >= 0 ? f[c.tono] : ''), calibre: normTxt_(c.cal >= 0 ? f[c.cal] : ''),
          acoOrig: '', ubiOrig: u.v, destino: /^S[A-Z]D/.test(sector) ? 'PICKING' : 'OTRO', detalle: sector,
          gruero: c.gru >= 0 ? String(f[c.gru] || '').trim().toUpperCase() : '', usuario: 'migracion', obs: 'Histórico migrado de SALIDAS (sin hora)', op: 'MIG-SALIDAS' });
      });
      histSal.sort(function (a, b) { return a.fecha - b.fecha; });
    }
    const idsHist = siguientes_('SEQ_MOV', histSal.length);
    const filasHist = histSal.map(function (m, k) { m.id = idMov_(idsHist[k]); return filaMov_(m); });

    // ---- 5) Maestro de ubicaciones: las usadas + huecos de cada pasillo (A-48, etc.)
    const usadas = {};
    pallets.forEach(function (p) { usadas[p.acopio + '|' + p.ubic] = true; }); // SALIDAS no indica acopio: no aporta ubicaciones
    const rangos = {}, especiales = [];
    Object.keys(usadas).forEach(function (k) {
      const a = k.split('|')[0], ub = k.split('|')[1];
      const m = ub.match(/^([A-Z])-(\d{2,3})$/);
      if (m) {
        const rk = a + '|' + m[1], n = parseInt(m[2], 10);
        if (!rangos[rk]) rangos[rk] = { min: n, max: n };
        rangos[rk].min = Math.min(rangos[rk].min, n); rangos[rk].max = Math.max(rangos[rk].max, n);
      } else {
        especiales.push({ a: a, ub: ub });
      }
    });
    const filasU = [];
    Object.keys(rangos).sort().forEach(function (rk) {
      const a = rk.split('|')[0], pas = rk.split('|')[1];
      for (let n = rangos[rk].min; n <= rangos[rk].max; n++) {
        const ub = pas + '-' + String(n).padStart(2, '0');
        filasU.push(filaUbic_({ acopio: a, ubic: ub, pasillo: pas, numero: n, cap: null, tipo: 'POSICION', activa: true,
          obs: usadas[a + '|' + ub] ? '' : 'Creada por secuencia (sin pallets al migrar)' }));
      }
    });
    especiales.forEach(function (e) {
      const pt = partesUbic_(e.ub);
      const tipo = e.ub === 'PISO' ? 'PISO' : (e.ub === 'PEGAMENTOS' || e.ub === 'SIN-UBIC' ? 'ZONA' : 'POSICION');
      filasU.push(filaUbic_({ acopio: e.a, ubic: e.ub, pasillo: pt.pasillo, numero: pt.numero, cap: null, tipo: tipo, activa: true,
        obs: tipo === 'ZONA' ? 'Zona transitoria: trasladar a una posición real' : '' }));
    });

    agregar_('PALLETS', filasP);
    agregar_('MOV', filasHist.concat(filasM)); // primero el histórico (más antiguo), luego el saldo inicial
    agregar_('UBIC', filasU);
    agregar_('LOG', log);
    PropertiesService.getScriptProperties().setProperty('MIGRADO', ahora.toISOString());

    const resumen = {
      pallets: pallets.length,
      acopio1: pallets.filter(function (p) { return p.acopio === '1'; }).length,
      acopio2: pallets.filter(function (p) { return p.acopio === '2'; }).length,
      pegamentos: pegPallets, ubicaciones: filasU.length, salidasHistoricas: filasHist.length, anotaciones: log.length,
    };
    Logger.log('Migración OK: ' + JSON.stringify(resumen));
    return resumen;
  } finally {
    lock.releaseLock();
  }
}
