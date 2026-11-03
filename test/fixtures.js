// Datos de prueba con la MISMA estructura que la planilla real de Limatco (cabeceras, filas de inicio, nombres de hojas).
const UB1 = 'A-00:3,A-01:4,A-02:4,A-03:4,A-04:4,A-05:4,A-06:5,A-07:3,A-08:3,A-09:3,A-10:4,A-11:4,A-12:3,A-13:3,A-14:4,A-15:3,A-16:4,A-17:1,A-18:2,A-19:2,A-20:4,A-21:3,A-22:2,A-23:4,A-24:3,A-25:4,A-26:3,A-27:4,A-28:2,A-29:4,A-30:3,A-31:4,A-32:3,A-33:3,A-34:3,A-34,2:3,A-35:13,A-36:3,A-37:3,A-38:5,A-39:3,A-40:2,A-41:3,A-42:5,A-43:5,A-44:12,A-45:20,A-46:5,A-47:3,A-49:4,A-50:3,A-51:3,B-00:9,B-01:3,B-02:5,B-03:3,B-04:3,B-05:5,B-06:4,B-07:4,B-08:4,B-09:5,B-10:3,B-11:2,B-12:2,B-13:1,B-14:2,D-04:8,D-05:14,D-06:14,D-07:2,D-08:6,PISO:2';
const UB2 = 'A-01:4,A-02:3,A-03:4,A-04:5,A-05:2,A-06:3,A-07:3,A-08:3,A-09:3,A-10:5,A-11:4,A-12:3,A-13:4,A-14:3,A-16:6,A-17:4,A-18:2,A-19:3,A-20:3,A-21:2,A-22:4,A-23:2,A-24:2,A-25:3,A-26:4,A-27:3,B-01:4,B-02:4,B-03:5,B-04:4,B-05:5,B-06:2,B-07:2,B-08:4,B-09:4,B-10:1,B-11:5,B-12:1,B-13:5,B-14:4,B-16:10,B-17:4,B-18:4,B-19:3,B-20:3,B-21:4,B-22:4,B-23:2,B-24:2,B-25:3,B-26:3,C-01:2,C-02:4,C-03:4,C-04:3,C-05:2,C-06:4,C-07:2,C-08:2,C-09:4,C-10:4,C-11:4,C-12:1,C-13:4,C-14:3,C-15:4,C-18:2,C-20:3,C-21:1,C-22:2,C-23:2,C-24:1,D-01:2,D-02:3,D-03:2,D-04:2,D-05:3,D-06:2,D-07:3,D-08:3,D-09:3,D-10:3,D-11:1,D-12:3,D-13:2,D-14:4,D-15:3,D-16:3,D-17:2,D-18:3,D-19:4,D-20:4,D-22:3,D-23:2,D-24:2,D-25:3,D-26:2,D-27:3,D-28:2,E-07:2,E-08:2,E-09:1,E-10:54,F-01:3,F-02:3,F-03:1,F-04:2,F-05:2,F-06:2,G-01:2,G-02:3,G-03:3,G-04:3,G-05:4,C-12:2,C-17:2,A-18:2,D-21:2,C-04:1,A-17:1';

const expandir = s => {
  const out = [];
  s.split(/,(?=[A-Z])/).forEach(tok => { const i = tok.lastIndexOf(':'); const u = tok.slice(0, i), n = +tok.slice(i + 1); for (let k = 0; k < n; k++) out.push(u); });
  return out;
};

// [codigo, descripcion, rendimiento, cajas por pallet, tono, calibre, picking]
const PROD = [
  ['11629', 'Mármol VPC58059 2Caras 58x58(2,35)', 2.35, 30, 5, 'no', 'SBD04U11NA'],
  ['48893BE', 'Petros Beige RT60541 60x60 (2,52)', 2.52, 32, 69, 6, 'SBD04U05NA'],
  ['9647BB', 'Polar Brick Blanco Brillo 30x60 (1,62)', 1.62, 60, '26A04', 'no', 'SDD01U28NA'],
  ['2219', 'Fuji 3Caras 57x57(2,3)', 2.3, 30, 522, 'no', 'SDD02U29NA'],
  ['3696', 'Marmo Travertino 57x57(2,3)', 2.3, 30, 80, 4, 'SBD02U21NB'],
  ['3065', 'Bombato Preston 14Caras 15x15(0,5)', 0.5, 84, 'T-C1', 'no', 'SDD03U12'],
  ['OUT9680', 'Geos Novu 20x30(1,5)', 1.5, 80, 305, 'no', 'SDD02U11NA'],
  ['3190CB', 'Fachaleta LXC 426A Cuarzita Beige 15x60(0,72)', 0.72, 48, 'no', 'no', 'SBD01U43ND'],
  ['40444MA', 'Gres Porc.Capital Marfil Rect.32Caras 30x60(1,44)', 1.44, 40, 'A251101', 'no', 'SCD05U06NB'],
  ['4691GR', 'Stage Gris (Johao Grey) 9Caras 51x51(2,08)', 2.08, 48, 855, 'no', 'SCDO3U19NA'],
  ['1456GR', 'Porc. Real Travertino Grey Mate 6Caras Rect. 60x60(1,44)', 1.44, 40, 'A07', 'no', 'SDD01U07NA'],
  ['8183CO', 'Coñac Brillo 108-4 Deston. 8mm(1,952)', 1.952, 70, 'no', 'no', 'SBD03U29NC'],
];
const PEG = [
  // codigo, marca, descripcion, ac01, ac02, flete, und
  [18753, 'BEMEZCLA', 'Bemezcla Piso Nivelador Saco 25 kilos', 0, 2, 0, 80],
  [18755, 'BEKRON', 'Bekron Saco 25 kilos', 0, 9, 0, 80],
  [18840, 'TORO', 'Adhesivo Porcelanato PRO Saco 25 Kilos Toro A&M', 0, 11, 0, 72],
  [18904, 'TORO', 'Adhesivo AC Polvo Gris  Saco 25 Kilos Toro A&M', 1, 0, 0, 72],
  [18897, 'CREST', 'Crest Porcelanato DA (2A) Saco 25 Kilos', 0, 7, 2, 80],
  ['18753GF', 'BEMEZCLA', 'Bemezcla Piso Nivelador GL Fino 25 kilos', 1, 0, 0, 40],
];

function cargar(ss, Sheet) {
  const nueva = (n) => { const s = new Sheet(n); ss.sheets.push(s); return s; };

  // ---- acopio 1: título fila 2, cabecera fila 5 (A..J)
  const a1 = nueva('acopio 1');
  a1._poner(2, 2, [['inventario acopio 1', '', '', '', new Date()]]);
  const cab1 = ['CODIGO', 'DESCRIPCION', 'RENDIMIENTO', 'MTS', 'CAJAS', 'TONO ', 'CALIBRE', 'UBICACION', 'PINKING', 'FECHA INGRESO'];
  const filas1 = expandir(UB1).map((u, i) => {
    const p = PROD[i % PROD.length];
    return [isNaN(+p[0]) ? p[0] : +p[0], p[1], p[2], p[2] * p[3], p[3], p[4], p[5], u, p[6], i % 17 === 0 ? '02-06-26' : ''];
  });
  filas1[5][1] = '#N/A';               // descripción con error → maestro
  filas1[7][4] = '';                   // sin cajas → se omite y se anota
  filas1.push(['', '', '', '', '', '', '', '', '-', '']); // filas basura con fórmulas al final
  a1._poner(5, 1, [cab1].concat(filas1));

  // ---- acopio 2: cabecera fila 6, con columna extra
  const a2 = nueva('acopio 2');
  const cab2 = ['CODIGO', 'DESCRIPCION', 'RENDIMIENTO', 'MTS', 'CAJAS', 'TONO ', 'CALIBRE', 'UBICACION', 'PICKING', 'FECHA INGRESO', 'Columna 1'];
  const filas2 = expandir(UB2).map((u, i) => {
    const p = PROD[(i + 3) % PROD.length];
    return [isNaN(+p[0]) ? p[0] : +p[0], p[1], p[2], p[2] * p[3], p[3], p[4], p[5], u, p[6], i % 23 === 0 ? new Date(2024, 3, 21) : '', ''];
  });
  a2._poner(6, 1, [cab2].concat(filas2));

  // ---- SALIDAS: cabecera en fila 7, columna C
  const sal = nueva('SALIDAS');
  const cabS = ['CODIGO', 'DESCRIPCION', 'RENDIMIENTO', 'MTS', 'CAJAS', 'TONO ', 'CALIBRE', 'ubicacion', 'SECTOR', 'GRUERO', 'FECHA', 'Column 12'];
  const grueros = ['DANILO', 'ALBERTO', 'VICTOR', 'JOSE', 'PATRICIO'];
  const filasS = [];
  for (let i = 0; i < 40; i++) {
    const p = PROD[i % PROD.length];
    filasS.push([p[0], p[1], p[2], p[2] * p[3], p[3], p[4], p[5], i === 3 ? 'A-0' : (i === 9 ? 'FLETE' : 'A-' + String(i % 50).padStart(2, '0')), i === 5 ? 'NO REGISTRA' : p[6], grueros[i % 5], new Date(2026, 9, 13 + (i % 15)), '']);
  }
  filasS.push(['9999', 'Sin fecha', 1, 1, 1, '', '', 'A-01', 'X', 'DANILO', '', '']);
  sal._poner(7, 3, [cabS].concat(filasS));

  // ---- PEGAMENTOS: cabecera fila 9, columna C
  const pg = nueva('PEGAMENTOS');
  pg._poner(8, 6, [['PALETS']]);
  const cabP = ['CODIGO', 'MARCA', 'DESCRIPCION', 'ACOPIO 01', 'ACOPIO 02', 'FLETE', 'UND X PALTS', 'TOTAL SACOS', 'PINKING', 'FISICO', 'FALTA', 'PICKING', 'Columna 1'];
  pg._poner(9, 3, [cabP].concat(PEG.map(r => r.concat([((r[3] + r[4] + r[5]) * r[6]), 'S/DESPACHO', 100, 0, '', '']))));

  // ---- TABLA DE CODIGOS (con espacio final en el nombre): cabecera fila 3, columna B
  const tc = nueva('TABLA DE CODIGOS ');
  const filasTC = PROD.map(p => [isNaN(+p[0]) ? p[0] : +p[0], p[1], p[2], p[2] / 10, ''])
    .concat(PEG.map(p => [p[0], p[2], 0, 0, '']))
    .concat([[10244, 'Rollo Vinílico Esteem 901L 200x500cm 2mm(10m2) AP', 0, '#N/A', ''], ['48782Gr', 'Abittare Grey 60x60 (1,44) IM OC', 1.44, 0.36, '']]);
  tc._poner(3, 2, [['CODIGO', 'Descripcion', 'MTS  X CAJA', 'MTS x palmeta', 'Columna 5']].concat(filasTC));

  // ---- fisico (export ERP): cabecera fila 4, columna B; códigos con minúsculas
  const fi = nueva('fisico');
  const cabF = ['Columna 1', 'Codigo_Tecnico', 'Descripcion', 'Serie', 'Disp', 'Cont', 'Bod', 'Ubicacion', 'Costo Promedio', 'Valor Ultima Compra'];
  const filasF = PROD.map((p, i) => ['BLA', i === 1 ? '48893Be' : p[0], p[1], '-', String(100 + i * 10).replace('.', ',') + ',5', 0, 150 + i * 10, p[6], 5000, '$7190.00'])
    .concat(PEG.map(p => ['BLA', p[0], p[2], '-', 300, 300, 300, 'Acopio 1', 7000, '$3450.00']));
  fi._poner(4, 2, [cabF].concat(filasF));

  return { a1: filas1.length - 1, a2: filas2.length, salidas: filasS.length };
}

module.exports = { cargar, PROD, PEG };
