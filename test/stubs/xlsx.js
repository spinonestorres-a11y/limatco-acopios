window.XLSX={utils:{aoa_to_sheet:a=>({a}),book_new:()=>({s:[]}),book_append_sheet:(wb,ws,n)=>wb.s.push([n,ws])},writeFile:(wb,name)=>{window.__xlsx={name,rows:wb.s[0][1].a.length}}};
