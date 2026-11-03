// Simulador mínimo de Google Apps Script (SpreadsheetApp, Utilities, etc.) para probar Code.gs en Node.
const crypto = require('crypto');
const fs = require('fs');
const vm = require('vm');

const vacio = v => v === '' || v === null || v === undefined;

class Range {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  _chk() {
    if (this.r < 1 || this.c < 1) throw new Error('Rango inválido');
    if (this.r + this.nr - 1 > this.sheet.maxRows || this.c + this.nc - 1 > this.sheet.maxCols)
      throw new Error(`The coordinates of the range are outside the dimensions of the sheet. (${this.sheet.name} r${this.r}+${this.nr} c${this.c}+${this.nc} max ${this.sheet.maxRows}x${this.sheet.maxCols})`);
  }
  getValues() {
    this._chk();
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet.data[this.r - 1 + i] || [];
      const o = [];
      for (let j = 0; j < this.nc; j++) { const v = row[this.c - 1 + j]; o.push(vacio(v) ? '' : v); }
      out.push(o);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(vals) {
    this._chk();
    if (vals.length !== this.nr || vals.some(r => r.length !== this.nc)) throw new Error(`setValues: dimensiones ${vals.length}x${vals[0] && vals[0].length} ≠ ${this.nr}x${this.nc}`);
    for (let i = 0; i < this.nr; i++) {
      const ri = this.r - 1 + i;
      if (!this.sheet.data[ri]) this.sheet.data[ri] = [];
      for (let j = 0; j < this.nc; j++) {
        let v = vals[i][j];
        if (v !== null && typeof v === 'object' && !(v instanceof Date)) throw new Error('setValues: objeto no soportado');
        this.sheet.data[ri][this.c - 1 + j] = v === undefined ? '' : v;
      }
    }
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setFormula(f) { this.sheet.formulas[`${this.r},${this.c}`] = f; this.setValue('#FORMULA'); return this; }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  getRow() { return this.r; }
  getColumn() { return this.c; }
  createTextFinder(text) {
    const rng = this; let entire = false, mcase = false;
    const tf = {
      matchEntireCell(b) { entire = b; return tf; },
      matchCase(b) { mcase = b; return tf; },
      findAll() {
        const vals = rng.getValues(), hits = [];
        const t = mcase ? String(text) : String(text).toLowerCase();
        vals.forEach((row, i) => row.forEach((v, j) => {
          let s = v instanceof Date ? v.toISOString() : String(v);
          if (!mcase) s = s.toLowerCase();
          if (entire ? s === t : s.includes(t)) hits.push(new Range(rng.sheet, rng.r + i, rng.c + j, 1, 1));
        }));
        return hits;
      },
      findNext() { return tf.findAll()[0] || null; },
    };
    return tf;
  }
}

class Sheet {
  constructor(name, rows = 1000, cols = 26) { this.name = name; this.data = []; this.maxRows = rows; this.maxCols = cols; this.formulas = {}; }
  getName() { return this.name; }
  getLastRow() { for (let i = this.data.length - 1; i >= 0; i--) if ((this.data[i] || []).some(v => !vacio(v))) return i + 1; return 0; }
  getLastColumn() { let m = 0; this.data.forEach(r => (r || []).forEach((v, j) => { if (!vacio(v)) m = Math.max(m, j + 1); })); return m; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const m = a.match(/^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/);
      const col = s => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
      const c1 = col(m[1]), r1 = m[2] ? +m[2] : 1;
      const c2 = m[3] ? col(m[3]) : c1, r2 = m[4] ? +m[4] : (m[2] ? r1 : this.maxRows);
      return new Range(this, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
    }
    return new Range(this, a, b, c || 1, d || 1);
  }
  insertRowsAfter(after, n) { this.data.splice(after, 0, ...Array.from({ length: n }, () => [])); this.maxRows += n; }
  insertColumnsAfter(after, n) { this.maxCols += n; }
  deleteRow(r) { this.deleteRows(r, 1); }
  deleteRows(r, n) { this.data.splice(r - 1, n); this.maxRows -= n; }
  setFrozenRows() {}
  // utilitario de prueba: escribe una matriz desde (fila, col)
  _poner(fila, col, matriz) {
    const filas = fila + matriz.length - 1, cols = col + Math.max(...matriz.map(r => r.length)) - 1;
    if (filas > this.maxRows) this.maxRows = filas + 10;
    if (cols > this.maxCols) this.maxCols = cols;
    matriz.forEach((r, i) => r.forEach((v, j) => { if (!this.data[fila - 1 + i]) this.data[fila - 1 + i] = []; this.data[fila - 1 + i][col - 1 + j] = v; }));
  }
}

class Spreadsheet {
  constructor() { this.sheets = []; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { if (this.getSheetByName(n)) throw new Error('Ya existe ' + n); const s = new Sheet(n); this.sheets.push(s); return s; }
  getId() { return 'TEST'; }
}

const signed = buf => Array.from(buf).map(b => (b > 127 ? b - 256 : b));
const unsigned = arr => Buffer.from(arr.map(b => (b + 256) % 256));
const b64ws = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

function crearEntorno(rutaCodigo) {
  const ss = new Spreadsheet();
  const props = {};
  const ctx = {
    console,
    SpreadsheetApp: { openById: () => ss, getActiveSpreadsheet: () => ss, flush() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => signed(crypto.createHash(alg).update(String(s), 'utf8').digest()),
      computeHmacSha256Signature: (v, k) => signed(crypto.createHmac('sha256', String(k)).update(String(v), 'utf8').digest()),
      base64EncodeWebSafe: x => b64ws(Array.isArray(x) ? unsigned(x) : Buffer.from(String(x), 'utf8')),
      base64DecodeWebSafe: s => signed(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      newBlob: bytes => ({ getDataAsString: () => unsigned(bytes).toString('utf8') }),
      getUuid: () => crypto.randomUUID(),
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType() { return this; }, getContent: () => s }) },
    Logger: { log: (...a) => console.log('[Logger]', ...a) },
    Date, JSON, Math, Object, Array, String, Number, parseInt, parseFloat, isFinite, isNaN, Error,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(rutaCodigo, 'utf8'), ctx, { filename: 'Code.gs' });
  const llamar = req => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(req) } }).getContent());
  return { ss, props, ctx, llamar, Sheet };
}

module.exports = { crearEntorno, Sheet };
