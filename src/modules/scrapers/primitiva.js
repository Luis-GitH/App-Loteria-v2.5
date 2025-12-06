// src/modules/scrapers/primitiva.js
import axios from "axios";
import * as cheerio from "cheerio";
import { parseEuroToFloat, normalizaOrdinal, filaPremioValida, normalizarSorteo, isoWeekNumberOffset, isInvalidResultadoPrimitiva, convertirFechaCorta } from "./common.js";

const HEADERS = { "User-Agent": "Mozilla/5.0", "Accept-Language": "es-ES,es;q=0.9" };
const MAP_MESES = { ene:"01", feb:"02", mar:"03", abr:"04", may:"05", jun:"06", jul:"07", ago:"08", sep:"09", oct:"10", nov:"11", dic:"12" };
const MAP_MESES_LARGO = { enero:"01", febrero:"02", marzo:"03", abril:"04", mayo:"05", junio:"06", julio:"07", agosto:"08", septiembre:"09", setiembre:"09", octubre:"10", noviembre:"11", diciembre:"12" };

const to2d = (v) => {
  const n = Number((v ?? "").toString().trim());
  return Number.isFinite(n) ? String(n).padStart(2, "0") : "";
};

const DIAS_VALIDOS_PRIMITIVA = new Set([1, 4, 6]); // lunes, jueves, sábado

// Ajuste de cierre de aÃ±o: en el histÃ³rico del nuevo aÃ±o pueden aparecer
// sorteos de finales de diciembre cuyo aÃ±o real es el anterior. Evita restar
// el aÃ±o si la fecha calculada ya cuadra con un dÃ­a de sorteo.
function convertirFechaAjuste(fechaTexto, anio) {
  const m = (fechaTexto || "").trim().toLowerCase().replace("ï¿½","a").match(/^(\d{1,2})-([a-z]{3,})$/i);
  if (!m) return "";
  const dia = m[1].padStart(2, "0");
  const mesTxt = m[2];
  const mes = MAP_MESES[mesTxt] || "01";

  if (mes !== "12") return `${anio}-${mes}-${dia}`;

  const fechaAnio = new Date(Number(anio), Number(mes) - 1, Number(dia));
  const dowAnio = fechaAnio.getDay();
  if (DIAS_VALIDOS_PRIMITIVA.has(dowAnio)) return `${anio}-${mes}-${dia}`;

  const fechaPrev = new Date(Number(anio) - 1, Number(mes) - 1, Number(dia));
  const dowPrev = fechaPrev.getDay();
  if (DIAS_VALIDOS_PRIMITIVA.has(dowPrev)) return `${Number(anio) - 1}-${mes}-${dia}`;

  // Si ninguno cuadra, conserva el aÃ±o original para no inventar fechas.
  return `${anio}-${mes}-${dia}`;
}

function convertirFecha(fechaTexto, anio) {
  return convertirFechaCorta(fechaTexto, MAP_MESES, { year: anio, replaceCharsWithA: /[á?]/g });
}

function fechaISOdesdeEspanol(desc) {
  if (!desc) return "";
  const m = desc.toLowerCase()
    .replace(/\u00a0/g, ' ')
    .match(/(\d{1,2})\s+de\s+([a-z--]+)\s+de\s+(\d{4})/i);
  if (!m) return "";
  const d = m[1].padStart(2,'0');
  const mesTxt = m[2].normalize('NFD').replace(/[^a-z]/g,'');
  const y = m[3];
  const mes = MAP_MESES_LARGO[mesTxt] || MAP_MESES[mesTxt?.slice(0,3)] || "";
  if (!mes) return "";
  return `${y}-${mes}-${d}`;
}

// Intento por pÃ¡gina del dÃ­a: "Sorteo-DD-MM-YYYY-<lunes|jueves|sabado>.html"
async function scrapeResultadoPrimitivaDia(fechaISO) {
  const [Y, M, D] = fechaISO.split("-");
  const d = new Date(Number(Y), Number(M) - 1, Number(D));
  const diasSlug = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
  const slug = diasSlug[d.getDay()];
  const dia = `${D.padStart(2, "0")}-${M.padStart(2, "0")}-${Y}`;

  const urls = [
    `https://www.laprimitiva.info/loteriaprimitiva/Sorteo-${dia}-${slug}.html`,
    `https://www.laprimitiva.info/loteriaprimitiva/Sorteo-${dia}-lunes.html`,
    `https://www.laprimitiva.info/loteriaprimitiva/Sorteo-${dia}-jueves.html`,
    `https://www.laprimitiva.info/loteriaprimitiva/Sorteo-${dia}-sabado.html`,
  ];

  for (const url of urls) {
    try {
      const { data: html } = await axios.get(url, { headers: HEADERS });
      const $ = cheerio.load(html);

      // 1) Intentar vÃ­a meta Description
      const metaDesc = $('meta[name="Description"], meta[name="description"]').attr('content') || '';
      if (metaDesc) {
        const fechaMeta = fechaISOdesdeEspanol(metaDesc);
        if (fechaMeta && fechaMeta !== fechaISO) {
          // La pÃ¡gina no corresponde a la fecha solicitada
          throw new Error('Fecha de pÃ¡gina no coincide');
        }
        const numsMatch = metaDesc.match(/n[uÃº]meros?:\s*([0-9,\s]+)/i);
        const compMatch = metaDesc.match(/complementario\s*:\s*(\d{1,2})/i);
        const reinMatch = metaDesc.match(/reintegro\s*:\s*(\d)/i);
        const numeros = [];
        if (numsMatch) {
          numsMatch[1].split(',').map(s => s.trim()).forEach(v => {
            const s2 = to2d(v);
            const n = Number(s2);
            if (Number.isFinite(n) && n >= 1 && n <= 49) numeros.push(s2);
          });
        }
        const complementario = compMatch ? to2d(compMatch[1]) : '';
        const reintegro = reinMatch ? String(Number(reinMatch[1])) : '';
        if (numeros.length === 6 && complementario && reintegro) {
          // NÂº de sorteo si aparece en cuerpo
          const body = $('body').text();
          let sorteo = '';
          const ms = body.match(/sorteo\s*(?:n[ÂºÂ°o]?|n[uÃº]mero|num\.?|#)?\s*(\d{1,3})(?!\s*de)/i);
          if (ms) sorteo = ms[1].padStart(3, '0');
          if (!sorteo) {
            try {
              const mariadb = await import('mariadb');
              const pool = mariadb.default.createPool({
                host: process.env.DB_HOST,
                user: process.env.DB_USER,
                password: process.env.DB_PASSWORD,
                database: process.env.DB_DATABASE,
                connectionLimit: 1,
              });
              const conn = await pool.getConnection();
              try {
                const prev = await conn.query(`SELECT sorteo FROM r_primitiva WHERE fecha < ? ORDER BY fecha DESC LIMIT 1`, [fechaISO]);
                if (prev.length) {
                  const prevS = (prev[0].sorteo || '').toString();
                  const base = prevS.includes('/') ? prevS.split('/')[1] : prevS;
                  const n = parseInt(base, 10);
                  if (Number.isFinite(n)) sorteo = String(n + 1).padStart(3, '0');
                }
              } finally { try { conn.release(); await pool.end(); } catch {} }
            } catch {}
          }
          const semana = isoWeekNumberOffset(fechaISO);
          return [{ semana, sorteo, fecha: fechaISO, numeros, complementario, reintegro }];
        }
      }

      // Candidatos de bolas
      const cand = [];
      $(".ball, .bola, .numero, .num, .nÃºmero").each((_, el) => {
        const t = $(el).text().trim();
        if (/^\d{1,2}$/.test(t)) cand.push(String(Number(t)));
      });
      if (cand.length < 6) {
        const txt = $("body").text();
        const matches = txt.match(/\b(\d{1,2})\b/g) || [];
        matches.forEach(v => cand.push(String(Number(v))));
      }

      const numeros = [];
      const seen = new Set();
      for (const v of cand) {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 1 && n <= 49) {
          const s2 = to2d(n);
          if (!s2 || seen.has(s2)) continue;
          numeros.push(s2);
          seen.add(s2);
          if (numeros.length === 6) break;
        }
      }

      // Complementario y Reintegro desde texto
      const body = $("body").text();
      // validar fecha en cuerpo si apareciera
      const fechaCuerpo = fechaISOdesdeEspanol(body);
      if (fechaCuerpo && fechaCuerpo !== fechaISO) throw new Error('Fecha cuerpo no coincide');
      let complementario = "";
      let reintegro = "";
      const mc = body.match(/complementario\D*(\d{1,2})/i);
      if (mc) complementario = to2d(mc[1]);
      const mr = body.match(/reintegro\D*(\d)/i);
      if (mr) reintegro = String(Number(mr[1]));

      // NÂº de sorteo (NNN) si aparece, evitando confundir "Sorteo 10 de ..."
      let sorteo = "";
      const ms = body.match(/sorteo\s*(?:n[ÂºÂ°o]?|n[uÃº]mero|num\.?|#)?\s*(\d{1,3})(?!\s*de)/i);
      if (ms) sorteo = ms[1].padStart(3, "0");
      if (!sorteo) {
        try {
          const mariadb = await import('mariadb');
          const pool = mariadb.default.createPool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_DATABASE,
            connectionLimit: 1,
          });
          const conn = await pool.getConnection();
          try {
            const prev = await conn.query(`SELECT sorteo FROM r_primitiva WHERE fecha < ? ORDER BY fecha DESC LIMIT 1`, [fechaISO]);
            if (prev.length) {
              const prevS = (prev[0].sorteo || '').toString();
              const base = prevS.includes('/') ? prevS.split('/')[1] : prevS;
              const n = parseInt(base, 10);
              if (Number.isFinite(n)) sorteo = String(n + 1).padStart(3, '0');
            }
          } finally { try { conn.release(); await pool.end(); } catch {} }
        } catch {}
      }

      if (numeros.length === 6 && complementario && reintegro) {
        const semana = isoWeekNumberOffset(fechaISO);
        const item = { semana, sorteo, fecha: fechaISO, numeros, complementario, reintegro };
        return [item];
      }
    } catch {
      // probar siguiente URL
    }
  }
  return [];
}

// Interno: scrape anual y devuelve array de resultados
async function scrapeResultadosPrimitivaYear(anio) {
  const url = `https://www.laprimitiva.info/historico/sorteos-la-primitiva-${anio}.html`;
  const { data: html } = await axios.get(url, { headers: HEADERS });
  const $ = cheerio.load(html);
  const out = [];
  let semana = "";

  $("table tbody tr").each((_, el) => {
    const tds = $(el).find("td");
    if (!tds.length) return;

    const first = $(tds[0]);
    const hasRowspan = first.attr("rowspan");
    if (hasRowspan) semana = first.text().trim();

    const k = hasRowspan ? 1 : 0;
    const sorteo = normalizarSorteo($(tds[0 + k]).text().trim(), { preferSlashTail: true });
    const fecha = convertirFechaAjuste($(tds[1 + k]).text().trim(), anio);

    const numeros = [];
    for (let i = 2 + k; i <= 7 + k; i++) {
      const v = $(tds[i]).text().trim(); if (v) numeros.push(to2d(v));
    }
    const complementario = to2d($(tds[8 + k])?.text().trim() || "");
    const reintegro = $(tds[9 + k])?.text().trim() || "";

    const item = { semana, sorteo, fecha, numeros, complementario, reintegro };
    if (!isInvalidResultadoPrimitiva(item)) out.push(item);
  });

  return out;
}

// Modo dual:
// - Si recibe un nÃºmero (aÃ±o), devuelve array con todos los resultados del aÃ±o (comportamiento existente).
// - Si recibe una fecha ISO (YYYY-MM-DD), inserta/actualiza en BD el resultado de ese dÃ­a y devuelve true/false.
export async function scrapeResultadosPrimitivaByFecha(input) {
  const isFecha = typeof input === "string" && /\d{4}-\d{2}-\d{2}/.test(input);
  if (!isFecha) {
    const anio = Number(input);
    return scrapeResultadosPrimitivaYear(anio);
  }

  const fechaISO = input;
  const [Y] = fechaISO.split("-");
  const anio = Number(Y);
  let items = await scrapeResultadosPrimitivaYear(anio);
  let r = items.find(it => it.fecha === fechaISO);
  // Fallback a pÃ¡gina del dÃ­a si aÃºn no estÃ¡ en el histÃ³rico
  if (!r) {
    const dia = await scrapeResultadoPrimitivaDia(fechaISO);
    if (dia && dia.length) r = dia[0];
  }
  if (!r) return false;

  // Insertar en BD este resultado concreto
  const mariadb = await import('mariadb');
  const pool = mariadb.default.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    connectionLimit: 2,
  });
  const conn = await pool.getConnection();
  try {
    await conn.query(
      `INSERT INTO r_primitiva (semana, sorteo, fecha, numeros, complementario, reintegro)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE numeros=VALUES(numeros), complementario=VALUES(complementario), reintegro=VALUES(reintegro)`,
      [r.semana || '', r.sorteo || '', r.fecha, (r.numeros || []).join(','), r.complementario || '', r.reintegro || '']
    );
    return true;
  } catch (e) {
    throw e;
  } finally {
    try { conn.release(); await pool.end(); } catch {}
  }
}

// ========== PREMIOS ==========
// Reemplaza en: src/modules/scrapers/primitiva.js

// --- helpers locales (deja los tuyos si ya existen) ---
// "Especial (6 Aciertos + Reintegro)" -> "6+R", "2Âª (5 Aciertos+C)" -> "5+C", "Reintegro" -> "R"
function aciertosFromCategoriaPrimitiva(cat) {
  const lower = cat.toLowerCase();
  if (lower.includes("reintegro") && !lower.includes("acierto")) return "R";
  const m = cat.match(/\(([^)]+)\)/);
  if (!m) return "";
  let x = m[1]
    .replace(/Aciertos?/gi, "")
    .replace(/\s+/g, "")
    .replace(/Reintegro/gi, "R")
    .replace(/\+?C/gi, "+C");
  return x.replace(/\+\+/, "+");
}

// --- NUEVA FUNCIÃ“N ---
export async function scrapePremiosPrimitivaByFecha(fechaISO) {
  // fechaISO: "YYYY-MM-DD"
  // Construimos SIEMPRE la URL exacta del sorteo usando el dÃ­a REAL (lunes/jueves/sabado)
  const [Y, M, D] = fechaISO.split("-");
  const d = new Date(Number(Y), Number(M) - 1, Number(D));
  const diaSemanaIdx = d.getDay(); // 0=domingo ... 6=sÃ¡bado

  // Mapeo a slug para URL (sin acento)
  const diasSlug = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
  const slug = diasSlug[diaSemanaIdx];
  // Solo deberÃ­a ser lunes, jueves o sabado (confirmado por ti).
  // Si no lo es, igualmente intentamos (algunas jornadas extraordinarias podrÃ­an aparecer).

  const dia = `${D.padStart(2, "0")}-${M.padStart(2, "0")}-${Y}`;

  // URL canÃ³nica para ese sorteo
  const url = `https://www.laprimitiva.info/loteriaprimitiva/Sorteo-${dia}-${slug}.html`;

  let html;
  try {
    const res = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "es-ES,es;q=0.9" } });
    html = res.data;
  } catch {
    // fallback muy conservador: si el dÃ­a no es lunes/jueves/sabado,
    // probamos estas 3 variantes por si la web lo colocÃ³ en el dÃ­a "esperado".
    const fallbacks = [
      `https://www.laprimitiva.info/loteriaprimitiva/Sorteo-${dia}-lunes.html`,
      `https://www.laprimitiva.info/loteriaprimitiva/Sorteo-${dia}-jueves.html`,
      `https://www.laprimitiva.info/loteriaprimitiva/Sorteo-${dia}-sabado.html`,
    ];
    for (const u of fallbacks) {
      try {
        const r = await axios.get(u, { headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "es-ES,es;q=0.9" } });
        html = r.data; break;
      } catch {}
    }
    if (!html) return []; // no hay pÃ¡gina para ese dÃ­a
  }

  const $ = cheerio.load(html);

  // Localizamos una tabla que tenga cabeceras con "categor" y "premio"
  // Validar que la pÃ¡gina corresponde a la fecha solicitada
  const metaDesc = $('meta[name="Description"], meta[name="description"]').attr('content') || '';
  const fechaMeta = fechaISOdesdeEspanol(metaDesc) || fechaISOdesdeEspanol($('body').text());
  if (fechaMeta && fechaMeta !== fechaISO) return [];

  const tabla = $("table").filter((_, el) => {
    const heads = $(el).find("th").map((i, th) => $(th).text().toLowerCase().trim()).get();
    return heads.some(h => h.includes("categor")) && heads.some(h => h.includes("premio"));
  }).first();

  if (!tabla.length) return [];

  const premios = [];
  tabla.find("tbody tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (!tds.length) return;

    const catRaw  = $(tds[0]).text().trim();
    const premRaw = $(tds[tds.length - 1]).text().trim(); // tomamos la Ãºltima columna (importe con â‚¬)

    if (!filaPremioValida(catRaw, premRaw)) return;

    const categoria = normalizaOrdinal(catRaw);
    premios.push({
      categoria,
      aciertos: aciertosFromCategoriaPrimitiva(categoria),
      premio: parseEuroToFloat(premRaw),
      premio_text: premRaw,
    });
  });

  // Si no hay premios, devolver tal cual
  if (!premios.length) return premios;

  // Insertar en BD normalizando sorteo a NNN
  const mariadb = await import('mariadb');
  const pool = mariadb.default.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    connectionLimit: 2,
  });
  const conn = await pool.getConnection();
  try {
    // Obtener sorteo desde r_primitiva
    const rows = await conn.query(`SELECT sorteo FROM r_primitiva WHERE fecha = ? LIMIT 1`, [fechaISO]);
    let sorteoNNN = '';
    if (rows.length) {
      const s = rows[0].sorteo?.toString() || '';
      sorteoNNN = (s.includes('/') ? s.split('/')[1] : s).toString().padStart(3,'0');
    } else {
      // Intentar desde pÃ¡gina: buscar "Sorteo NNN"
      const body = $('body').text();
      const ms = body.match(/sorteo\D*(\d{1,3})/i);
      if (ms) sorteoNNN = ms[1].padStart(3,'0');
    }
    if (!sorteoNNN) return premios;

    for (const p of premios) {
      await conn.query(
        `INSERT INTO premios_sorteos (tipoApuesta, sorteo, fecha, categoria, aciertos, premio, premio_text)
         VALUES ('primitiva', ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE premio=VALUES(premio), premio_text=VALUES(premio_text), categoria=VALUES(categoria)`,
        [sorteoNNN, fechaISO, p.categoria, p.aciertos, Number(p.premio||0), p.premio_text||'']
      );
    }
  } finally {
    try { conn.release(); await pool.end(); } catch {}
  }
  return premios;
}
