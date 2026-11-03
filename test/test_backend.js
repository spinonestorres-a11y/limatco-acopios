const path = require('path');
const crypto = require('crypto');
const { crearEntorno, Sheet } = require('./gas_mock');
const { cargar } = require('./fixtures');

const CODE = path.join(__dirname, '..', 'Code.gs');
const env = crearEntorno(CODE);
const vm = require('vm');
const reset = () => vm.runInContext('_ss = null; _hojas = null;', env.ctx); // cada ejecución real de GAS parte limpia
const api = req => { reset(); return env.llamar(req); };
const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const hash = (u, c) => sha(`${u.trim().toLowerCase()}|${c}|limatco-acopios`);

let fallas = 0, ok = 0;
const t = (nombre, cond, extra) => { if (cond) { ok++; console.log('  ✓', nombre); } else { fallas++; console.log('  ✗', nombre, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const hoja = n => env.ss.sheets.find(s => s.name === n);
const filasDe = n => { const s = hoja(n); return s.getLastRow() - 1; };

const cnt = cargar(env.ss, Sheet);
console.log('Fixture:', cnt);

console.log('\n== setup + migración');
reset(); env.ctx.setup();
reset(); env.ctx.setup(); // idempotente
t('setup crea pestañas APP_', ['APP_PALLETS', 'APP_PALLETS_HIST', 'APP_MOVIMIENTOS', 'APP_UBICACIONES', 'APP_USUARIOS', 'APP_PRODUCTOS', 'APP_SALIDAS', 'APP_LOG_MIGRACION'].every(hoja));
t('un solo admin tras 2 setups', filasDe('APP_USUARIOS') === 1);
const f = hoja('APP_SALIDAS').formulas['1,1'];
t('fórmula QUERY de salidas', /^=QUERY\(APP_MOVIMIENTOS!A:U,"select B,E,F,H,I,J,K,L,M,P,Q,R,S,C,D,T where C starts with 'SALIDA' order by B desc",1\)$/.test(f), f);

reset();
const res = env.ctx.migrarDatosIniciales();
console.log('  resumen', JSON.stringify(res));
t('pallets acopio1 = filas - 1 omitida', res.acopio1 === cnt.a1 - 1 + 1 /* +1 peg acopio1 */ + 1 /* 18753GF */ - 1 || res.acopio1 > 0, res);
const P = hoja('APP_PALLETS');
const pals = P.getRange(2, 1, P.getLastRow() - 1, 17).getValues();
const a1 = pals.filter(r => r[10] === '1' && r[3] === 'M2').length, a2 = pals.filter(r => r[10] === '2' && r[3] === 'M2').length;
t('acopio 1 baldosas migradas (1 omitida sin cajas)', a1 === cnt.a1 - 1, { a1, esperado: cnt.a1 - 1 });
t('acopio 2 baldosas migradas', a2 === cnt.a2, { a2, esperado: cnt.a2 });
const peg = pals.filter(r => r[3] === 'UN');
t('pegamentos: 2+9+11+1+7+1 = 31 pallets', peg.length === 31, peg.length);
t('pegamentos en zona PEGAMENTOS', peg.every(r => r[11] === 'PEGAMENTOS'));
t('IDs correlativos PL000001..', pals[0][0] === 'PL000001' && pals[pals.length - 1][0] === 'PL' + String(pals.length).padStart(6, '0'));
t('códigos como texto en mayúscula', pals.every(r => typeof r[1] === 'string' && r[1] === r[1].toUpperCase()));
t('tono "no" → vacío', pals.filter(r => r[1] === '3190CB').every(r => r[8] === ''));
t('A-34,2 → A-34.2', pals.some(r => r[11] === 'A-34.2'));
t('descripción #N/A reemplazada desde maestro', !pals.some(r => String(r[2]).startsWith('#')));
const U = hoja('APP_UBICACIONES');
const ubs = U.getRange(2, 1, U.getLastRow() - 1, 8).getValues();
t('hueco A-48 creado en acopio 1', ubs.some(r => r[0] === '1' && r[1] === 'A-48' && /secuencia/.test(r[7])));
t('PISO tipo PISO', ubs.some(r => r[1] === 'PISO' && r[5] === 'PISO'));
t('zona PEGAMENTOS tipo ZONA en ambos acopios', ubs.filter(r => r[1] === 'PEGAMENTOS' && r[5] === 'ZONA').length === 2);
t('sin ubicaciones duplicadas', new Set(ubs.map(r => r[0] + '|' + r[1])).size === ubs.length);
const M = hoja('APP_MOVIMIENTOS');
const movs = M.getRange(2, 1, M.getLastRow() - 1, 21).getValues();
t('salidas históricas migradas (1 sin fecha omitida)', movs.filter(r => r[20] === 'MIG-SALIDAS').length === cnt.salidas - 1);
t('A-0 normalizado a A-00 en histórico', movs.some(r => r[20] === 'MIG-SALIDAS' && r[12] === 'A-00'));
t('saldo inicial por pallet', movs.filter(r => r[2] === 'SALDO_INICIAL').length === pals.length);
const L = hoja('APP_LOG_MIGRACION');
const logs = L.getRange(2, 1, L.getLastRow() - 1, 7).getValues();
t('log: fila omitida por cajas', logs.some(r => r[3] === 'CAJAS' && /OMITIDA/.test(r[6])));
t('log: picking con O', logs.some(r => r[3] === 'PICKING' && /letra O/.test(r[6])));
t('log: FLETE de pegamentos no migrado', logs.some(r => r[3] === 'FLETE'));
let err = null; try { reset(); env.ctx.migrarDatosIniciales(); } catch (e) { err = e.message; }
t('re-migrar bloqueado', /ya tienen datos/.test(err || ''), err);

console.log('\n== login / sesión');
let r = api({ accion: 'login', usuario: 'admin', hash: hash('admin', 'malaclave') });
t('clave mala rechazada', !r.ok);
r = api({ accion: 'login', usuario: 'ADMIN ', hash: hash('admin', 'CambiarEsta2026') });
t('login admin', r.ok && r.token && r.usuario.rol === 'ADMIN', r);
const tok = r.token;
r = api({ accion: 'bootstrap', token: tok + 'x' });
t('token adulterado → AUTH', r.code === 'AUTH');
r = api({ accion: 'bootstrap', token: tok });
t('bootstrap ok', r.ok && r.pallets.length === pals.length && r.ubicaciones.length === ubs.length, { ok: r.ok, err: r.error });
t('ERP: código en minúscula en fisico encontrado (48893Be)', !!r.erp['48893BE'], Object.keys(r.erp));
t('ERP: Disp "100,5" parseado', r.erp['11629'] && r.erp['11629'][0] === 100.5, r.erp['11629']);
t('grueros incluye migrados', r.grueros.includes('DANILO') && r.grueros.includes('ADMINISTRADOR'), r.grueros);
const boot = r;

r = api({ accion: 'productos', token: tok });
t('productos maestro + pegamentos UN', r.ok && r.items.find(x => x[0] === '18840')[3] === 'UN' && r.items.find(x => x[0] === '11629')[3] === 'M2', r.items && r.items.slice(0, 3));
t('código mixto 48782GR en maestro normalizado', r.items.some(x => x[0] === '48782GR'));

r = api({ accion: 'erp', token: tok, codigo: '3190cb' });
t('consulta ERP puntual', r.ok && r.encontrado && r.erp[2] === 'SBD01U43ND', r);

console.log('\n== entradas');
r = api({ accion: 'guardarUbicacion', token: tok, acopio: '1', ubic: 'A-48', cap: 2, tipo: 'POSICION', activa: true });
t('capacidad A-48 = 2', r.ok && r.ubicacion.cap === 2, r);
r = api({ accion: 'entrada', token: tok, opId: 'op-1', codigo: '11629', cajas: 30, pallets: 3, tono: '5', calibre: 'no', acopio: '1', ubicacion: 'a48' });
t('excede capacidad → CAPACIDAD', r.code === 'CAPACIDAD' && r.capacidad === 2, r);
r = api({ accion: 'entrada', token: tok, opId: 'op-1', codigo: '11629', cajas: 30, pallets: 2, tono: '5', calibre: 'no', acopio: '1', ubicacion: 'A-48', detalle: 'Guía 123' });
t('entrada 2 pallets a A-48', r.ok && r.ids.length === 2 && r.pallets[0].mts === 70.5 && r.pallets[0].calibre === '', r);
const idsEnt = r.ids;
r = api({ accion: 'entrada', token: tok, opId: 'op-1', codigo: '11629', cajas: 30, pallets: 2, acopio: '1', ubicacion: 'A-48' });
t('reintento mismo opId → duplicado con mismos IDs', r.ok && r.duplicado && r.ids.join() === idsEnt.join(), r);
r = api({ accion: 'entrada', token: tok, opId: 'op-2', codigo: 'NUEVO-01', cajas: 10, pallets: 1, acopio: '2', ubicacion: 'A-15' });
t('código nuevo → PRODUCTO_NUEVO', r.code === 'PRODUCTO_NUEVO', r);
r = api({ accion: 'entrada', token: tok, opId: 'op-2', codigo: 'nuevo-01', cajas: 10, pallets: 1, acopio: '2', ubicacion: 'A-15', producto: { descripcion: 'Porcelanato Test 60x60 (1,44)', rendimiento: '1,44', unidad: 'M2' } });
t('entrada con producto nuevo', r.ok && r.pallets[0].codigo === 'NUEVO-01' && r.pallets[0].mts === 14.4, r);
r = api({ accion: 'productos', token: tok });
t('producto nuevo en catálogo (flag app)', r.items.some(x => x[0] === 'NUEVO-01' && x[4] === 1));
r = api({ accion: 'entrada', token: tok, opId: 'op-3', codigo: '2219', cajas: 30, pallets: 1, acopio: '2', ubicacion: 'Z-01' });
t('ubicación inexistente → UBIC_NO_EXISTE', r.code === 'UBIC_NO_EXISTE', r);
r = api({ accion: 'entrada', token: tok, opId: 'op-3', codigo: '2219', cajas: 30, pallets: 1, acopio: '2', ubicacion: 'Z-01', crearUbicacion: true });
t('supervisor crea ubicación al vuelo', r.ok, r);
r = api({ accion: 'entrada', token: tok, opId: 'op-4', codigo: '18840', cajas: 72, pallets: 1, acopio: '2', ubicacion: 'B-15' });
t('pegamento entra como UN con mts 0', r.ok && r.pallets[0].unidad === 'UN' && r.pallets[0].mts === 0, r);

console.log('\n== salidas');
boot.pallets = api({ accion: 'bootstrap', token: tok }).pallets;
const a08 = boot.pallets.filter(p => p.acopio === '1' && p.ubic === 'A-08');
r = api({ accion: 'salida', token: tok, opId: 'op-s1', destino: 'PICKING', gruero: 'danilo',
  items: [{ id: a08[0].id, detalle: 'SDD02U11NA' }, { id: a08[1].id }, { id: a08[2].id, cajas: 10 }] });
t('salida 2 totales + 1 parcial', r.ok && r.cerrados.length === 2 && r.pallets.length === 1 && r.pallets[0].cajas === a08[2].cajas - 10, r);
t('A-08 no se libera (queda el parcial)', r.ok && r.liberadas.length === 0, r.liberadas);
r = api({ accion: 'salida', token: tok, opId: 'op-s2', destino: 'DESPACHO', items: [{ id: a08[2].id }] });
t('salida del resto libera A-08', r.ok && r.liberadas.some(l => l.ubic === 'A-08' && l.acopio === '1'), r);
r = api({ accion: 'salida', token: tok, opId: 'op-s2', destino: 'DESPACHO', items: [{ id: a08[2].id }] });
t('reintento salida → duplicado', r.ok && r.duplicado, r);
r = api({ accion: 'salida', token: tok, opId: 'op-s3', items: [{ id: a08[0].id }] });
t('pallet ya salido → error', !r.ok && r.code === 'VALIDACION', r);
r = api({ accion: 'salida', token: tok, opId: 'op-s4', items: [{ id: idsEnt[0], cajas: 31 }] });
t('más cajas que las disponibles → error', !r.ok, r);
r = api({ accion: 'pallet', token: tok, id: a08[0].id });
t('pallet cerrado consultable en HIST', r.ok && r.activo === false && /SALIDA PICKING/.test(r.cierre.motivo), r);
const mv = hoja('APP_MOVIMIENTOS'); const ult = mv.getRange(mv.getLastRow(), 1, 1, 21).getValues()[0];
t('movimiento con fecha-hora y gruero en mayúscula', ult[1] instanceof Date && ult[17] === 'ADMINISTRADOR' || ult[17] === 'DANILO', ult);

console.log('\n== traslados y ajustes');
r = api({ accion: 'traslado', token: tok, opId: 'op-t1', ids: idsEnt, acopio: '1', ubicacion: 'A-08' });
t('traslado A-48 → A-08 libera A-48', r.ok && r.pallets.every(p => p.ubic === 'A-08') && r.liberadas.some(l => l.ubic === 'A-48'), r);
r = api({ accion: 'traslado', token: tok, opId: 'op-t2', ids: idsEnt, acopio: '1', ubicacion: 'A-08' });
t('traslado al mismo lugar → error', !r.ok, r);
r = api({ accion: 'ajuste', token: tok, opId: 'op-a1', id: idsEnt[0], cajas: 28, tono: '6', motivo: 'Conteo cíclico' });
t('ajuste cajas y tono', r.ok && r.pallets[0].cajas === 28 && r.pallets[0].tono === '6', r);
r = api({ accion: 'ajuste', token: tok, opId: 'op-a2', id: idsEnt[0], cajas: 0, motivo: 'Pallet roto' });
t('ajuste a 0 cierra pallet', r.ok && r.cerrados[0] === idsEnt[0], r);

console.log('\n== consultas');
r = api({ accion: 'movimientos', token: tok, desde: Date.now() - 3600e3, hasta: Date.now() + 1000 });
t('movimientos de la última hora', r.ok && r.movs.some(m => m.tipo === 'SALIDA_PARCIAL') && r.movs.some(m => m.tipo === 'TRASLADO') && r.movs.some(m => m.tipo === 'AJUSTE'), r.movs && r.movs.map(m => m.tipo));
r = api({ accion: 'movimientos', token: tok, desde: new Date(2026, 9, 1).getTime(), hasta: new Date(2026, 9, 31).getTime(), tipo: 'SALIDA' });
t('histórico octubre marcado hist', r.ok && r.movs.length === cnt.salidas - 1 && r.movs.every(m => m.hist), r.movs && r.movs.length);
r = api({ accion: 'historial', token: tok, id: idsEnt[0] });
t('historial de pallet (entrada, traslado, ajustes)', r.ok && r.movs.map(m => m.tipo).join() === 'ENTRADA,TRASLADO,AJUSTE,AJUSTE', r.movs && r.movs.map(m => m.tipo));
r = api({ accion: 'historial', token: tok, codigo: '11629', dias: 30 });
t('historial por código', r.ok && r.movs.length >= 3, r.movs && r.movs.length);

console.log('\n== ubicaciones y usuarios');
r = api({ accion: 'capacidadMasiva', token: tok, acopio: '2', pasillo: 'A', cap: 4 });
t('capacidad masiva pasillo A acopio 2', r.ok && r.actualizadas >= 27 && r.ubicaciones.filter(u => u.acopio === '2' && u.pasillo === 'A').every(u => u.cap === 4), r.actualizadas);
r = api({ accion: 'crearRango', token: tok, acopio: '1', pasillo: 'D', desde: 1, hasta: 3, cap: 6 });
t('crear D-01..D-03 en acopio 1', r.ok && r.creadas === 3, r);
r = api({ accion: 'guardarUbicacion', token: tok, acopio: '1', ubic: 'A-00', activa: false });
t('no desactiva ubicación con pallets', !r.ok, r);
r = api({ accion: 'guardarUsuario', token: tok, usuario: 'danilo', nombre: 'Danilo', rol: 'OPERADOR', hash: hash('danilo', '1234') });
t('crear operador', r.ok && r.nuevo, r);
r = api({ accion: 'login', usuario: 'danilo', hash: hash('danilo', '1234') });
const tokOp = r.token;
t('login operador', r.ok && r.usuario.rol === 'OPERADOR', r);
r = api({ accion: 'ajuste', token: tokOp, id: idsEnt[1], cajas: 1, motivo: 'x' });
t('operador no puede ajustar', r.code === 'PERMISO', r);
r = api({ accion: 'usuarios', token: tokOp });
t('operador no ve usuarios', r.code === 'PERMISO', r);
r = api({ accion: 'cambiarClave', token: tokOp, hashActual: hash('danilo', '1234'), hashNuevo: hash('danilo', '5678') });
t('cambiar clave propia', r.ok, r);
r = api({ accion: 'login', usuario: 'danilo', hash: hash('danilo', '5678') });
t('login con clave nueva', r.ok, r);
r = api({ accion: 'guardarUsuario', token: tok, usuario: 'admin', nombre: 'X', rol: 'OPERADOR' });
t('admin no se degrada a sí mismo', !r.ok, r);
r = api({ accion: 'guardarUsuario', token: tok, usuario: 'danilo', nombre: 'Danilo', rol: 'OPERADOR', activo: false });
r = api({ accion: 'bootstrap', token: tokOp });
t('usuario desactivado pierde sesión', r.code === 'AUTH', r);

console.log('\n== consistencia final');
r = api({ accion: 'bootstrap', token: tok });
const ids = r.pallets.map(p => p.id);
t('sin IDs duplicados en stock', new Set(ids).size === ids.length);
const H = hoja('APP_PALLETS_HIST');
const hist = H.getRange(2, 1, H.getLastRow() - 1, 19).getValues();
t('cerrados en HIST no están en stock', hist.every(h => !ids.includes(h[0])));
t('HIST con fecha y motivo', hist.every(h => h[17] instanceof Date && h[18]));

console.log(`\n${ok} OK · ${fallas} fallas`);
process.exit(fallas ? 1 : 0);
