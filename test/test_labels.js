const path=require('path'),fs=require('fs'),http=require('http');const {chromium}=require('playwright');
const RAIZ=path.join(__dirname,'..');fs.mkdirSync(path.join(__dirname,'shots'),{recursive:true});const STUB=f=>fs.readFileSync(path.join(__dirname,'stubs',f),'utf8');
const srv=http.createServer((q,r)=>{const f=path.join(RAIZ,q.url.split('?')[0]==='/'?'index.html':q.url.split('?')[0]);if(!fs.existsSync(f)){r.writeHead(404);return r.end();}r.writeHead(200,{'Content-Type':f.endsWith('.html')?'text/html':'application/octet-stream'});fs.createReadStream(f).pipe(r);}).listen(8766);
(async()=>{const b=await chromium.launch();const c=await b.newContext({viewport:{width:800,height:1200}});
await c.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:STUB('qrcode.js')}));
await c.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
const p=await c.newPage();await p.addInitScript(()=>{window.print=()=>{}});await p.goto('http://localhost:8766/');
await p.fill('[name=usuario]','admin');await p.fill('[name=clave]','admin');await p.click('#btn-login');await p.waitForSelector('#app:not([hidden])');await p.waitForTimeout(800);
await p.emulateMedia({media:'print'});
for (const f of ['100x150','100x50']){await p.evaluate(f=>imprimirEtiquetas([S.pallets[5]],f),f);await p.waitForTimeout(200);await p.locator('#print-area .lbl').first().screenshot({path:path.join(__dirname,'shots',`lbl_${f}.png`)});}
await p.evaluate(()=>imprimirEtiquetasUbic(S.ubic.slice(0,3),'a4u'));await p.waitForTimeout(200);await p.locator('#print-area .ub-a4-grid').first().screenshot({path:path.join(__dirname,'shots','lbl_ubic.png')});
await p.evaluate(()=>{imprimirComprobante({fecha:Date.now(),lineas:S.pallets.slice(0,3).map(x=>({id:x.id,codigo:x.codigo,desc:x.desc,tono:x.tono,calibre:x.calibre,unidad:x.unidad,cajas:x.cajas,mts:x.mts,acopio:x.acopio,ubic:x.ubic,total:true})),destino:'PICKING',detalle:'',gruero:'CARLOS',usuario:'admin',obs:'',liberadas:[{acopio:'1',ubic:'A-08'}]})});await p.waitForTimeout(200);
await p.pdf({path:path.join(__dirname,'shots','comprobante.pdf'),format:'A4'});
await b.close();srv.close();})();
