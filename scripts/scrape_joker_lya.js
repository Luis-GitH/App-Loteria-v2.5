import puppeteer from 'puppeteer';

async function run(fechaISO) {
  const [Y, M, D] = fechaISO.split('-');
  const fechaSlash = `${D}/${M}/${Y}`; // e.g. 15/06/2026
  const url = 'https://www.loteriasyapuestas.es/es/resultados/primitiva';

  const execPath = process.env.CHROME_PATH || '/usr/bin/chromium-browser';
  const browser = await puppeteer.launch({ headless: true, executablePath: execPath, args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(60000);
  try {
    await page.goto(url, { waitUntil: 'networkidle2' });

    // esperar carga de resultados
    await new Promise((res) => setTimeout(res, 1500));

    // Intentar cerrar/aceptar banner de cookies si aparece
    try {
      await page.evaluate(() => {
        const texts = ['Permitir todas las cookies', 'Solo usar cookies necesarias', 'Aceptar', 'Aceptar cookies', 'Permitir'];
        for (const t of texts) {
          const btn = Array.from(document.querySelectorAll('button, a')).find(x => (x.innerText||'').trim().toLowerCase().includes(t.toLowerCase()));
          if (btn) try { btn.click(); } catch (e) {}
        }
      });
    } catch (e) {}
    await new Promise((res) => setTimeout(res, 800));

    // Buscar elementos que contengan la fecha (formatos con espacios)
    const candidates = await page.$$eval('*', (els, fechaSlash) => {
      const matches = [];
      for (const el of els) {
        try {
          const text = (el.innerText || '').replace(/\u00a0/g,' ').trim();
          if (!text) continue;
          if (text.includes(fechaSlash)) {
            matches.push({ xpath: null, outerHTML: el.outerHTML });
          }
        } catch (e) { /* ignore */ }
      }
      return matches.slice(0, 20);
    }, fechaSlash);

    // Try to click Info near the first matching element
    let modalText = null;
    if (candidates.length === 0) {
      console.log('No se encontró el bloque con la fecha', fechaSlash);
    }

    // We'll search for elements that have the date and an Info button nearby
    const clicked = await page.evaluate(async (fechaSlash) => {
      function findAncestor(el, test) {
        let cur = el;
        while (cur && cur !== document.body) {
          if (test(cur)) return cur;
          cur = cur.parentElement;
        }
        return null;
      }

      const all = Array.from(document.querySelectorAll('*'));
      for (const el of all) {
        try {
          const text = (el.innerText || '').replace(/\u00a0/g,' ');
          if (!text.includes(fechaSlash)) continue;
          // Try to find an "Info" button inside this block or nearby
          const block = findAncestor(el, (n) => n.querySelector && (n.querySelector('button') || n.querySelector('a')));
          if (!block) continue;
          // Prefer buttons/links with 'Info' text
          const btn = Array.from(block.querySelectorAll('button, a')).find(x => /(info|más info|más información|más info|info\b)/i.test(x.innerText || '') || x.getAttribute('aria-label') && /(info)/i.test(x.getAttribute('aria-label')));
          if (btn) {
            btn.click();
            return { clicked: true };
          }
          // fallback: look for elements with data-url/data-href attributes and click
          const btn2 = Array.from(block.querySelectorAll('[data-url],[data-href],[data-target]')).find(x => true);
          if (btn2) { btn2.click(); return { clicked: true } }
        } catch (e) { /* ignore */ }
      }
      return { clicked: false };
    }, fechaSlash);

    if (clicked.clicked) {
      // wait for modal/dialog to appear
      try {
        await page.waitForSelector('[role="dialog"], .modal, .mfp-content, .modal-body, .dialog', { timeout: 5000 });
        } catch (e) {
        // maybe dynamic, wait a bit
        await new Promise((res) => setTimeout(res, 1000));
      }

      // extract visible modal text
      modalText = await page.evaluate(() => {
        const sel = document.querySelector('[role="dialog"], .modal, .mfp-content, .modal-body, .dialog');
        if (!sel) return document.body.innerText || '';
        return sel.innerText || sel.textContent || '';
      });
    } else {
      // fallback: extract surrounding text near the date element
      modalText = await page.evaluate((fechaSlash) => {
        // find element that contains the date and gather neighbor texts
        const el = Array.from(document.querySelectorAll('*')).find(n => (n.innerText||'').replace(/\u00a0/g,' ').includes(fechaSlash));
        if (!el) return '';
        let text = '';
        const block = el.closest('article, section, div') || el.parentElement;
        if (block) text = block.innerText || block.textContent || '';
        // append next siblings
        let nxt = block && block.nextElementSibling;
        let hops = 0;
        while (nxt && hops < 4) { text += '\n' + (nxt.innerText||''); nxt = nxt.nextElementSibling; hops++; }
        return text;
      }, fechaSlash);
    }

    await new Promise((res) => setTimeout(res, 200));

    // parse modalText for Joker number and prize
    if (modalText) {
      const normalized = modalText.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
      const numMatch = normalized.match(/(\d[\d\s]{5,}\d)/);
      const euroMatch = normalized.match(/([\d\.\,]+\s*€)/);
      const jokerNum = numMatch ? numMatch[1].replace(/\s+/g,'') : null;
      const prize = euroMatch ? euroMatch[1].trim() : null;
      return { modalText: normalized, joker: jokerNum, premio: prize };
    }

    return { modalText: null };
  } catch (err) {
    return { error: String(err) };
  } finally {
    try { await browser.close(); } catch (e) {}
  }
}

if (process.argv.length < 3) {
  console.error('Uso: node scrape_joker_lya.js YYYY-MM-DD');
  process.exit(1);
}

const fecha = process.argv[2];
run(fecha).then(r => console.log('RESULT:', JSON.stringify(r,null,2))).catch(e=>{ console.error(e); process.exit(1)});
