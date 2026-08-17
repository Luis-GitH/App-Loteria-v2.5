import axios from 'axios';
import * as cheerio from 'cheerio';
const url = 'https://www.loteriasyapuestas.es/es/resultados/primitiva';
(async ()=>{
  const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language':'es-ES,es' } });
  const lower = data.toLowerCase();
  console.log('Contains "logojoker"?', lower.includes('logojoker'));
  console.log('Contains "joker"?', lower.includes('joker'));
  const idx = lower.indexOf('joker');
  if (idx !== -1) {
    const start = Math.max(0, idx - 200);
    console.log('Context around first "joker":\n', data.slice(start, start + 600));
  } else {
    console.log('No "joker" text found in HTML response');
  }
  // buscar endpoints relacionados con resultados
  const regex = /\/(es\/)?resultados[\w\-\/\?=&%\.\(\)\[\]\'\"]*/ig;
  const found = new Set();
  let m;
  while ((m = regex.exec(data)) !== null) {
    found.add(m[0]);
  }
  console.log('Found candidate resultado endpoints:', Array.from(found).slice(0,20));
  // scan inline scripts for clues
  const scripts = data.match(/<script[\s\S]*?<\/script>/ig) || [];
  console.log('Total script tags:', scripts.length);
  scripts.forEach((s, i) => {
    const lowerS = s.toLowerCase();
    if (lowerS.includes('resultados') || lowerS.includes('servicios') || lowerS.includes('sorteo') || lowerS.includes('joker')) {
      console.log('--- Script', i, 'snippet:');
      console.log(s.slice(0, 800));
      console.log('--- end script', i);
    }
  });
  // buscar llamadas ajax/getJSON/fetch en scripts
  scripts.forEach((s, i) => {
    if (s.includes('.getJSON(') || s.toLowerCase().includes('fetch(') || s.toLowerCase().includes('$.ajax(') || s.toLowerCase().includes('jqheader.getjson') || s.toLowerCase().includes('getjson')) {
      console.log('*** Script with ajax/getJSON at index', i);
      const snippet = s.replace(/\n/g,'\\n').slice(0,2000);
      console.log(snippet);
    }
  });
  // parse with cheerio to read data-* attributes
  const $ = cheerio.load(data);
  const headerMain = $('#header-main');
  if (headerMain.length) {
    const attrs = headerMain[0].attribs || {};
    console.log('#header-main attributes:', attrs);
  } else {
    console.log('No header-main element found');
  }
  // find any element with data-json-service-url
  const elems = $('[data-json-service-url]').toArray();
  console.log('Found', elems.length, 'elements with data-json-service-url');
  elems.slice(0,10).forEach((el, i) => {
    console.log(i, el.attribs['id'] || el.attribs['class'] || el.name, '->', el.attribs['data-json-service-url']);
  });
  // find data-draw-id occurrences
  const draws = $('[data-draw-id]').toArray();
  console.log('Found', draws.length, 'elements with data-draw-id');
  draws.slice(0,10).forEach((el, i) => {
    console.log(i, 'idAttr:', el.attribs['id'] || '', 'data-draw-id:', el.attribs['data-draw-id'], 'data-draw-date:', el.attribs['data-draw-date']);
  });
  // list external script src attributes
  const scriptSrcs = $('script[src]').toArray().map(s=>s.attribs.src);
  console.log('External script srcs (count):', scriptSrcs.length);
  scriptSrcs.slice(0,40).forEach((src, i)=>console.log(i, src));
  // try to fetch first few external scripts that look like resultados/buscador
  for (let i=0;i<Math.min(10,scriptSrcs.length);i++){
    const src = scriptSrcs[i];
    if (!src) continue;
    const full = src.startsWith('http')?src:('https://www.loteriasyapuestas.es'+src);
    try{
      const r = await axios.get(full, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const txt = r.data;
      if (txt.includes('masInfo') || txt.includes('resultadoSorteo') || txt.includes('qa_resultadoSorteo')){
        console.log('--- fetched', full, 'contains masInfo/resultados - snippet:');
        console.log(txt.slice(0,1200));
      }
    }catch(e){
      // ignore
    }
  }
})();
