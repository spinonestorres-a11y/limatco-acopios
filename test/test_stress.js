const path=require('path'),vm=require('vm'),crypto=require('crypto');const {crearEntorno,Sheet}=require('./gas_mock');const {cargar}=require('./fixtures');
const env=crearEntorno(path.join(__dirname,'..','Code.gs'));cargar(env.ss,Sheet);
const reset=()=>vm.runInContext('_ss=null;_hojas=null;',env.ctx);reset();env.ctx.setup();reset();env.ctx.migrarDatosIniciales();
const api=r=>{reset();return env.llamar(r)};const h=crypto.createHash('sha256').update('admin|CambiarEsta2026|limatco-acopios').digest('hex');
const tok=api({accion:'login',usuario:'admin',hash:h}).token;
api({accion:'guardarUbicacion',token:tok,acopio:'2',ubic:'E-10',tipo:'PISO',activa:true});
let ids=[];const t0=Date.now();
for(let i=0;i<8;i++){const r=api({accion:'entrada',token:tok,opId:'s'+i,codigo:'2219',cajas:30,pallets:60,acopio:'2',ubicacion:'E-10',tono:'1E2',calibre:'05-10'});if(!r.ok){console.log('fallo',r);process.exit(1)}ids=ids.concat(r.ids)}
const r=api({accion:'salida',token:tok,opId:'big',items:ids.slice(0,80).map(id=>({id}))});
const M=env.ss.sheets.find(s=>s.name==='APP_MOVIMIENTOS');const P=env.ss.sheets.find(s=>s.name==='APP_PALLETS');
console.log('salida 80:',r.ok,'cerrados',r.cerrados.length,'liberadas',r.liberadas.length);
console.log('MOV filas',M.getLastRow(),'max',M.maxRows,'· PALLETS filas',P.getLastRow());
const b=api({accion:'bootstrap',token:tok});console.log('bootstrap pallets',b.pallets.length,'tono',b.pallets.find(p=>p.id===ids[100]).tono,'ms total',Date.now()-t0);
