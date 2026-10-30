(() => {
  'use strict';
  const input=document.getElementById('artwork'),status=document.getElementById('file-status'),frame=document.getElementById('preview'),preview=document.getElementById('art-preview');
  let objectURL=null,revision=0;
  const reset=()=>{if(objectURL)URL.revokeObjectURL(objectURL);objectURL=null;preview.removeAttribute('src');frame.hidden=true;status.className='';};
  input.addEventListener('change',async()=>{
    const current=++revision;reset();const file=input.files[0];
    if(!file){status.textContent='No file selected.';return;}
    const fail=message=>{status.className='error';status.textContent=message;};
    if(file.size>5*1024*1024){fail('Choose an SVG or PNG smaller than 5 MB.');return;}
    const head=new Uint8Array(await file.slice(0,8).arrayBuffer());if(current!==revision)return;
    const isPNG=[137,80,78,71,13,10,26,10].every((b,i)=>head[i]===b);
    let source=file;
    if(!isPNG){
      const text=await file.text();if(current!==revision)return;
      const doc=new DOMParser().parseFromString(text,'image/svg+xml');
      if(doc.querySelector('parsererror')||doc.documentElement.localName!=='svg'){fail('This file is not a readable SVG or PNG.');return;}
      if(/<!DOCTYPE|<!ENTITY/i.test(text)||doc.querySelector('script,foreignObject,image,animate,animateTransform,set')){fail('Export a static, self-contained SVG, or use a PNG.');return;}
      const externalCSS=value=>/@|\\|javascript|expression\s*\(/i.test(value)||[...value.matchAll(/url\s*\(([^)]*)\)/gi)].some(m=>!m[1].trim().replace(/^["']|["']$/g,'').startsWith('#'));
      for(const node of doc.querySelectorAll('*')){
        if(node.localName==='style'&&externalCSS(node.textContent)){fail('Use an SVG without external styles or files.');return;}
        for(const attr of [...node.attributes]){
        if(/^on/i.test(attr.name)||((attr.localName==='href')&&!attr.value.startsWith('#'))||externalCSS(attr.value)){fail('Use an SVG without interactive content or external files.');return;}
        }
      }
      for(const node of doc.querySelectorAll('metadata,title,desc'))node.remove();
      source=new Blob([new XMLSerializer().serializeToString(doc)],{type:'image/svg+xml'});
    }
    objectURL=URL.createObjectURL(source);preview.src=objectURL;
    preview.onload=()=>{if(current!==revision)return;frame.hidden=false;status.textContent=file.name+' · '+Math.ceil(file.size/1024)+' KB · Preview ready. Attach the file in the submission form.';};
    preview.onerror=()=>{if(current===revision){reset();fail('The image could not be displayed. Export another SVG or PNG.');}};
  });
  window.addEventListener('pagehide',reset);
})();
