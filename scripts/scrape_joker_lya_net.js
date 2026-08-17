import puppeteer from 'puppeteer';

const url = 'https://www.loteriasyapuestas.es/es/resultados/primitiva';
const dateArg = process.argv[2] || '2026-06-15';
function formatDateDDMMYYYY(iso){
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

(async ()=>{
  const targetDate = formatDateDDMMYYYY(dateArg);
  console.log('Target date:', targetDate);
  const browser = await puppeteer.launch({headless:true, executablePath:'/usr/bin/chromium-browser', args:['--no-sandbox','--disable-setuid-sandbox']});
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64)');
  const requests = [];
  page.on('request', req => {
    requests.push({url: req.url(), method: req.method()});
  });
  try{
    await page.goto(url, {waitUntil: 'networkidle2', timeout: 60000});
  }catch(e){
    console.error('Failed to load page:', e.message);
  }
  // wait for draws container
  try{
    await page.waitForSelector('.c-resultados-buscador__primitiva, .c-resultado-sorteo__primitiva', {timeout:15000});
  }catch(e){
    console.error('Draw list not found in DOM');
  }
  const candidates = await page.$$eval('.c-resultado-sorteo__cabecera--primitiva, .c-resultado-sorteo__primitiva .c-resultado-sorteo__cabecera--primitiva', nodes => nodes.map(n=>({id: n.id, date: n.getAttribute('data-draw-date'), text: n.innerText, html: n.innerHTML})).slice(0,50));
  console.log('Found candidate header nodes:', candidates.length);
  candidates.forEach((c, i)=>{
    console.log(i, c.id, c.date, c.text.trim().slice(0,120));
  });
  // try to find node whose date attribute or text contains targetDate
  const foundIndex = candidates.findIndex(c => (c.date && c.date.includes(targetDate)) || (c.text && c.text.includes(targetDate)) );
  let jokerNumber = null;
  let jokerPrize = null;
  if (foundIndex === -1){
    console.log('No candidate header matching date found');
  } else {
    console.log('Clicking candidate index', foundIndex);
    // click the corresponding element in page context
    await page.evaluate((idx, date) => {
      const nodes = Array.from(document.querySelectorAll('.c-resultado-sorteo__cabecera--primitiva, .c-resultado-sorteo__primitiva .c-resultado-sorteo__cabecera--primitiva'));
      const target = nodes[idx];
      if (target) {
        const parentAnchor = target.closest('.c-resultado-sorteo__primitiva')?.querySelector('.c-resultado-sorteo__enlace-cabecera') || target.closest('.c-resultado-sorteo__primitiva') || target;
        if (parentAnchor) parentAnchor.click();
      }
    }, foundIndex, targetDate);
    // wait a bit for network (compatibility fallback)
    await new Promise(r => setTimeout(r, 2500));
    // capture modal content and try to extract Joker number and prize
    const modalText = await page.$$eval('.c-resultado-sorteo__joker-posicion, .c-resultado-sorteo__joker, .c-modal, .modal', els => els.map(e=>e.innerText).join('\n---\n') ).catch(()=>null);
    // try specific joker element
    const jokerText = await page.$$eval('.c-resultado-sorteo__joker-ganador, .c-resultado-sorteo__joker', els => els.map(e=>e.innerText).join('\n') ).catch(()=>null);
    let jokerNumber = null;
    let jokerPrize = null;
    const combined = ((jokerText||'') + '\n' + (modalText||'')).trim();
    if (combined) {
      // look for grouped number like '0 334 540' or plain 7-digit
      const m = combined.match(/(\d{1,3}(?:[ \u00A0]\d{3})+)/);
      if (m) {
        jokerNumber = m[1].replace(/[^0-9]/g,'');
        if (jokerNumber.length === 7) {
          // ok
        } else if (jokerNumber.length > 7) {
          jokerNumber = jokerNumber.slice(-7);
        }
      }
      // look for prize like 'premio joker ... €' or amounts with euro
      const p = combined.match(/premio[\s\S]{0,30}?([0-9\.,]+)\s*€/i) || combined.match(/importe[\s\S]{0,30}?([0-9\.,]+)\s*€/i);
      if (p) {
        jokerPrize = p[1].replace(/\./g,'').replace(',', '.');
      }
    }
    console.log('Modal text length:', combined ? combined.length : 'null');
    if (combined) console.log('Modal snippet:\n', combined.slice(0,2000));
    console.log('Extracted:', {jokerNumber, jokerPrize});
  }
  console.log('Captured requests (last 30):');
  requests.slice(-30).forEach(r=>console.log(r.method, r.url));
  // output JSON summary for consumption
  console.log('\nJSON::' + JSON.stringify({date: dateArg, joker: jokerNumber, jokerPrize}));
  await browser.close();
})();
