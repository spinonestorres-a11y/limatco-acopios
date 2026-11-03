// E2E: index.html real contra Code.gs real (simulado en Node), con CDNs reemplazados por stubs.
const path = require('path'), fs = require('fs'), http = require('http'), vm = require('vm'), crypto = require('crypto');
const { chromium } = require('playwright');
const { crearEntorno, Sheet } = require('./gas_mock');
const { cargar } = require('./fixtures');

const RAIZ = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const API = 'https://script.google.com/macros/s/TEST/exec';
const MODO = process.argv[2] || 'e2e'; // e2e | demo

// copia de index.html con API_URL configurada
const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
fs.writeFileSync(path.join(RAIZ, '_e2e.html'), MODO === 'e2e' ? html.replace("API_URL: '',", `API_URL: '${API}',`) : html);

const srv = http.createServer((req, res) => {
  const f = path.join(RAIZ, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/_e2e.html'));
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const ext = path.extname(f);
  res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png' }[ext] || 'text/plain' });
  fs.createReadStream(f).pipe(res);
}).listen(8765);

const env = crearEntorno(path.join(RAIZ, 'Code.gs'));
cargar(env.ss, Sheet);
const reset = () => vm.runInContext('_ss = null; _hojas = null;', env.ctx);
reset(); env.ctx.setup(); reset(); const mig = env.ctx.migrarDatosIniciales();
let llamadas = 0, offline = false;

const STUB = f => fs.readFileSync(path.join(__dirname, 'stubs', f), 'utf8');
const errores = [];
let fallas = 0, oks = 0;
const t = (n, c, x) => { if (c) { oks++; console.log('  ✓', n); } else { fallas++; console.log('  ✗', n, x !== undefined ? String(JSON.stringify(x)).slice(0, 300) : ''); } };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'es-CL', timezoneId: 'America/Santiago' });
  await ctx.route('https://cdn.jsdelivr.net/**', r => {
    const u = r.request().url();
    const f = u.includes('qrcode-generator') ? 'qrcode.js' : u.includes('chart.js@') ? 'chart.js' : u.includes('datalabels') ? 'datalabels.js' : u.includes('xlsx') ? 'xlsx.js' : u.includes('html5-qrcode') ? 'scanner.js' : null;
    return f ? r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB(f) }) : r.abort();
  });
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route('https://fonts.gstatic.com/**', r => r.abort());
  await ctx.route(API, async r => {
    if (offline) return r.abort('internetdisconnected');
    llamadas++; reset();
    const out = env.ctx.doPost({ postData: { contents: r.request().postData() } }).getContent();
    r.fulfill({ status: 200, contentType: 'application/json', body: out });
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errores.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/INTERNET_DISCONNECTED/.test(m.text())) errores.push('console: ' + m.text()); });
  await page.addInitScript(() => { window.print = () => { window.__print = (window.__print || 0) + 1; window.__printHTML = document.getElementById('print-area').innerHTML; }; });
  const shot = n => page.screenshot({ path: path.join(SHOTS, `${MODO}_${n}.png`), fullPage: false });
  const esperarToast = async txt => page.waitForSelector(`.toast:has-text("${txt}")`, { timeout: 8000 }).then(() => true).catch(() => false);

  await page.goto('http://localhost:8765/');
  await page.waitForSelector('#login:not([hidden])');
  await shot('01_login');
  const user = MODO === 'e2e' ? 'admin' : 'admin', pass = MODO === 'e2e' ? 'CambiarEsta2026' : 'admin';
  await page.fill('[name=usuario]', 'ADMIN'); await page.fill('[name=clave]', 'mala'); await page.click('#btn-login');
  await page.waitForFunction(() => document.querySelector('#login-err').textContent.length > 0);
  t('clave incorrecta muestra error', await page.textContent('#login-err'));
  await page.fill('[name=usuario]', user); await page.fill('[name=clave]', pass); await page.click('#btn-login');
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForFunction(() => document.querySelectorAll('.ri').length > 0, null, { timeout: 15000 });
  const kp = await page.textContent('.kpi .k-v');
  t('home muestra pallets en acopio', MODO === 'demo' ? +kp.replace(/\./g, '') > 50 : +kp.replace(/\./g, '') === mig.pallets, { kp, mig: mig.pallets });
  await page.waitForTimeout(400);
  await shot('02_home');

  // ---------- búsqueda y ficha
  await page.fill('#q', 'travertino');
  await page.waitForTimeout(300);
  const nres = await page.locator('.ri').count();
  t('búsqueda por descripción', nres >= 1, nres);
  await page.fill('#q', '3190');
  await page.waitForTimeout(250);
  await page.locator('.ri').first().click();
  await page.waitForSelector('.ficha-h');
  await page.waitForFunction(() => !document.querySelector('#f-hist .empty') || !/Cargando/.test(document.querySelector('#f-hist').textContent), null, { timeout: 8000 });
  await page.waitForTimeout(300);
  const ficha = await page.textContent('#v-buscar');
  t('ficha: código y descripción', /3190CB/.test(ficha) && /Fachaleta/.test(ficha));
  t('ficha: ERP (físico/disp/fuera de acopio)', /Físico ERP/.test(ficha) && /Fuera de acopio/.test(ficha));
  t('ficha: tono y calibre + ubicaciones', /Tono y calibre/.test(ficha) && /Ubicaciones/.test(ficha));
  await shot('03_ficha');
  await page.evaluate(() => window.scrollTo(0, 99999)); await page.waitForTimeout(200); await shot('03b_ficha_hist');

  // ---------- pallet modal
  await page.locator('.prow').first().click();
  await page.waitForSelector('.modal .p-grid');
  await shot('04_pallet');
  await page.click('.modal [data-act=cerrarModal]');

  // ---------- entrada
  await page.click('#nav [data-v=entrada]');
  await page.waitForSelector('#ent-cod');
  await page.fill('#ent-cod', '1145');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  await page.fill('#ent-cod', '11629');
  await page.waitForSelector('#ent-ac:not([hidden]) button');
  await page.locator('#ent-ac button').first().dispatchEvent('mousedown');
  await page.waitForSelector('.prod-card');
  t('entrada: producto seleccionado', /11629/.test(await page.textContent('.prod-card')));
  await page.fill('#ent-cajas', '30');
  await page.click('[data-act=entPal][data-d="1"]');
  await page.fill('#ent-tono', '5');
  const ubicEnt = MODO === 'e2e' ? 'A-48' : 'A-24';
  await page.fill('#ent-ubic', ubicEnt.toLowerCase().replace('-', ''));
  await page.waitForTimeout(150);
  const stUb = await page.textContent('#ent-ubic-st');
  t('entrada: estado de ubicación', stUb.length > 3, stUb);
  const sugs = await page.locator('#ent-sug .chip').count();
  t('entrada: sugerencias de ubicación', sugs > 0, sugs);
  await shot('05_entrada');
  await page.click('#ent-ok');
  await page.waitForSelector('.modal:has-text("Entrada registrada")', { timeout: 10000 });
  const okEnt = await page.textContent('.modal');
  const idsEnt = okEnt.match(/PL\d{6}/g) || [];
  t('entrada: 2 pallets con ID', idsEnt.length === 2, okEnt.slice(0, 200));
  await shot('06_entrada_ok');
  await page.click('.modal [data-act=imprimirRecientes]');
  await page.waitForTimeout(300);
  t('entrada: imprime etiquetas QR', await page.evaluate(() => window.__print >= 1 && /lbl-100x150/.test(window.__printHTML) && /<svg/.test(window.__printHTML)));

  // ---------- código nuevo
  await page.fill('#ent-cod', 'ZZ-NUEVO-9');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#ent-ndesc');
  await page.fill('#ent-ndesc', 'Porcelanato Prueba 60x60 (1,44)');
  await page.fill('#ent-nrend', '1,44');
  await page.fill('#ent-cajas', '40');
  await page.fill('#ent-ubic', 'Z-99');
  await page.click('#ent-ok');
  await page.waitForSelector('.modal:has-text("Ubicación nueva")', { timeout: 8000 });
  await page.click('.modal [data-x=si]');
  await page.waitForSelector('.modal:has-text("Entrada registrada")', { timeout: 8000 });
  t('entrada: producto nuevo + ubicación creada al vuelo', true);
  await page.click('.modal [data-act=cerrarModal]');

  // ---------- salida (lote, parcial, liberación)
  await page.click('#nav [data-v=salida]');
  await page.waitForSelector('#sal-add');
  await page.fill('#sal-add', idsEnt[0]); await page.click('[data-act=salAgregar]');
  await page.fill('#sal-add', idsEnt[1]); await page.click('[data-act=salAgregar]');
  await page.waitForTimeout(150);
  t('salida: 2 pallets en el lote', (await page.locator('.ll').count()) === 2);
  await page.click(`[data-act=llMenos][data-id="${idsEnt[1]}"]`);
  await page.waitForTimeout(100);
  t('salida: línea parcial', /PARCIAL/.test(await page.textContent('#v-salida')));
  // agregar por código con selector FIFO
  await page.fill('#sal-add', MODO === 'e2e' ? 'OUT9680' : '2219');
  await page.click('[data-act=salAgregar]');
  await page.waitForSelector('#ep-list');
  await shot('07_selector_fifo');
  await page.locator('#ep-list input:not(:disabled)').first().check();
  await page.click('#ep-ok');
  await page.waitForTimeout(200);
  t('salida: 3 pallets en lote', (await page.locator('.ll').count()) === 3);
  await page.click('[data-act=salDestino][data-d=DESPACHO]');
  await page.fill('#sal-det', 'Guía 55123');
  await shot('08_salida');
  await page.click('#sal-ok');
  await page.waitForSelector('.modal:has-text("Salida registrada")', { timeout: 10000 });
  const okSal = await page.textContent('.modal');
  t('salida registrada con fecha y hora', /\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}/.test(okSal), okSal.slice(0, 160));
  await shot('09_salida_ok');
  await page.click('.modal [data-act=imprimirComprobante]');
  await page.waitForTimeout(200);
  t('comprobante de salida imprimible', await page.evaluate(() => /COMPROBANTE DE SALIDA/.test(window.__printHTML)));
  await page.click('.modal [data-act=cerrarModal]');

  // ---------- offline: salida encolada y sincronizada
  if (MODO === 'e2e') {
    const otro = await page.evaluate(() => S.pallets.find(p => p.ubic === 'A-10' && p.acopio === '1').id);
    await page.fill('#sal-add', otro); await page.click('[data-act=salAgregar]');
    offline = true;
    await page.click('#sal-ok');
    await page.waitForSelector('.modal:has-text("Salida registrada")', { timeout: 10000 });
    t('offline: salida encolada', /sin conexión/i.test(await page.textContent('.modal')));
    await page.click('.modal [data-act=cerrarModal]');
    t('offline: pill muestra pendiente', /pendiente/.test(await page.textContent('#sync-pill')));
    await shot('10_offline');
    offline = false;
    await page.evaluate(() => sincronizar(true));
    await page.waitForFunction(() => S.outbox.length === 0, null, { timeout: 10000 });
    const enHist = env.ss.sheets.find(s => s.name === 'APP_PALLETS_HIST').data.some(r => r[0] === otro);
    t('offline: sincronizado y cerrado en servidor', enHist);
  }

  // ---------- mapa
  await page.click('#nav [data-v=mapa]');
  await page.waitForSelector('#v-mapa .cell');
  await shot('11_mapa');
  await page.locator('#v-mapa .cell.st-libre, #v-mapa .cell.st-ocupada, #v-mapa .cell.st-parcial').first().click();
  await page.waitForSelector('.modal .kgrid');
  await shot('12_ubic');
  await page.click('.modal [data-act=cerrarModal]');
  // capacidades
  await page.click('[data-act=capMasiva]');
  await page.fill('#cm-cap', '4');
  await page.click('#cm-ok');
  t('capacidad masiva aplicada', await esperarToast('posiciones actualizadas'));
  await page.waitForTimeout(200);
  await shot('13_mapa_cap');
  // resaltar código
  await page.fill('#mapa-q', MODO === 'e2e' ? '3190CB' : '3190CB');
  await page.waitForTimeout(300);
  t('mapa: resalta código', (await page.locator('#v-mapa .cell.hit').count()) >= 1);

  // ---------- traslado desde ficha de pallet
  const pid = await page.evaluate(() => S.pallets.find(p => p.acopio === '1' && !p.tmp).id);
  await page.evaluate(id => abrirPallet(id), pid);
  await page.waitForSelector('.modal [data-act=palTraslado]');
  await page.click('.modal [data-act=palTraslado]');
  await page.waitForSelector('#tr-ub');
  await page.click('#tr-ac [data-a="2"]');
  await page.locator('#tr-sug .chip').first().click();
  await shot('14_traslado');
  await page.click('#tr-ok');
  const trOk = await esperarToast('Trasladado');
  t('traslado registrado', trOk);

  // ---------- movimientos
  await page.evaluate(() => ir('movs'));
  await page.waitForSelector('.mv-tbl', { timeout: 10000 });
  const nmov = await page.locator('.mv-tbl tbody tr').count();
  t('movimientos de hoy (entradas+salidas+traslado)', nmov >= 6, nmov);
  await page.selectOption('#mv-t', 'SALIDA');
  await page.waitForTimeout(150);
  await shot('15_movs');
  await page.click('[data-act=mvExcel]');
  await page.waitForFunction(() => window.__xlsx, null, { timeout: 5000 });
  t('exporta Excel', await page.evaluate(() => window.__xlsx.rows > 1 && /limatco_movimientos/.test(window.__xlsx.name)));
  await page.click('[data-act=mvPlanilla]');
  await page.waitForTimeout(150);
  t('planilla de salida imprimible con fecha y hora', await page.evaluate(() => /PLANILLA DE SALIDA/.test(window.__printHTML) && /\d{2}:\d{2}:\d{2}/.test(window.__printHTML)));

  // ---------- dashboard
  await page.evaluate(() => { window.__charts = []; ir('dash'); });
  await page.waitForFunction(() => (window.__charts || []).length >= 6, null, { timeout: 10000 });
  const cfgs = await page.evaluate(() => window.__charts.map(c => ({ t: c.type, n: c.data.labels.length, dl: !!(c.options && c.options.plugins && c.options.plugins.datalabels) || true })));
  t('dashboard: 6 gráficos', cfgs.length >= 6, cfgs);
  await page.waitForTimeout(300);
  await shot('16_dash');
  await page.evaluate(() => window.scrollTo(0, 1400)); await page.waitForTimeout(150); await shot('16b_dash');

  // ---------- etiquetas
  await page.evaluate(() => ir('etiquetas'));
  await page.waitForSelector('#etq-all');
  await page.check('#etq-all');
  await page.waitForTimeout(150);
  await page.selectOption('#etq-fmt', 'a4');
  await page.click('[data-act=etqImprimir]');
  await page.waitForTimeout(200);
  t('etiquetas A4 6 por hoja', await page.evaluate(() => /a4-grid/.test(window.__printHTML)));
  await page.click('[data-act=etqModo][data-m=ubic]');
  await page.check('#etq-all');
  await page.click('[data-act=etqImprimir]');
  await page.waitForTimeout(200);
  t('etiquetas de ubicación con QR UB|', await page.evaluate(() => /ub-a4-grid/.test(window.__printHTML)));
  await shot('17_etiquetas');

  // ---------- admin
  await page.evaluate(() => ir('admin'));
  await page.waitForSelector('#adm-body table', { timeout: 8000 });
  t('admin: lista de usuarios', /admin/.test(await page.textContent('#adm-body')));
  await page.click('[data-act=usrNuevo]');
  await page.fill('#us-u', 'danilo'); await page.fill('#us-n', 'Danilo'); await page.fill('#us-c', '1234');
  await page.click('#us-ok');
  t('admin: crear usuario', await esperarToast('Usuario creado'));
  await shot('18_admin');

  // ---------- escritorio
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.evaluate(() => ir('mapa')); await page.waitForTimeout(250); await shot('20_desk_mapa');
  await page.evaluate(() => abrirFicha('3190CB')); await page.waitForTimeout(700); await shot('21_desk_ficha');
  await page.evaluate(() => { window.__charts = []; ir('dash'); }); await page.waitForTimeout(900); await shot('22_desk_dash');
  await page.evaluate(() => ir('salida')); await page.waitForTimeout(250); await shot('23_desk_salida');

  // ---------- operador: permisos de UI
  await page.evaluate(() => ACT.salir());
  await page.waitForSelector('#login:not([hidden])');
  await page.fill('[name=usuario]', MODO === 'e2e' ? 'danilo' : 'ventas'); await page.fill('[name=clave]', '1234'); await page.click('#btn-login');
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForTimeout(500);
  const navTxt = await page.textContent('#nav');
  t(MODO === 'e2e' ? 'operador ve Entrada/Salida' : 'consulta no ve Entrada/Salida', MODO === 'e2e' ? /Entrada/.test(navTxt) && /Salida/.test(navTxt) : !/Entrada/.test(navTxt), navTxt);

  t('sin errores JS en consola', errores.length === 0, errores);
  console.log(`\n${MODO}: ${oks} OK · ${fallas} fallas · llamadas API: ${llamadas}`);
  await browser.close(); srv.close();
  fs.unlinkSync(path.join(RAIZ, '_e2e.html'));
  process.exit(fallas ? 1 : 0);
})().catch(async e => { console.error('ERROR', e); console.log(errores); srv.close(); process.exit(2); });
