(function(){
  function Chart(ctx,cfg){this.cfg=cfg;(window.__charts=window.__charts||[]).push(cfg);try{const cv=ctx.canvas;const w=cv.width=cv.clientWidth||300,h=cv.height=cv.clientHeight||200;const ds=cfg.data.datasets;const n=cfg.data.labels.length;const max=Math.max(1,...ds.flatMap(d=>d.data));const horiz=cfg.options&&cfg.options.indexAxis==='y';ds.forEach((d,j)=>{ctx.fillStyle=Array.isArray(d.backgroundColor)?d.backgroundColor[0]:d.backgroundColor;d.data.forEach((v,i)=>{if(horiz){const bh=(h/n)*0.7/ds.length;ctx.fillRect(40,i*(h/n)+j*bh,(w-60)*v/max,bh-1);}else{const bw=(w/n)*0.7/ds.length;ctx.fillRect(i*(w/n)+j*bw+4,h-20-(h-40)*v/max,bw-1,(h-40)*v/max);}});});ctx.fillStyle='#9FB3A9';ctx.font='10px monospace';ctx.fillText('[stub Chart.js] '+cfg.type+' · '+n+' etiquetas',6,12);}catch(e){} }
  Chart.prototype.destroy=function(){};Chart.prototype.update=function(){};
  Chart.defaults={color:'',font:{},plugins:{legend:{labels:{}},tooltip:{}},maintainAspectRatio:true};
  Chart.register=function(p){if(p&&p.id==='datalabels')Chart.defaults.plugins.datalabels=Object.assign({},p.defaults)};
  window.Chart=Chart;
})();
