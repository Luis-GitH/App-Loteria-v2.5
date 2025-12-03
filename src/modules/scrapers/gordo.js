// src/modules/scrapers/gordo.js
import axios from "axios";
import * as cheerio from "cheerio";
import { getISOWeek } from "date-fns";
import { fechaParamFromISO, parseEuroToFloat, formatPremioText, normalizaOrdinal, filaPremioValida, normalizarSorteo, isoWeekNumberOffset, convertirFechaCorta, isInvalidResultadoGordo } from "./common.js";

const REFERER = "https://www.loteriasyapuestas.es/es/resultados/gordo-primitiva";
const API_BASE = "https://www.loteriasyapuestas.es/servicios";
const BUSCADOR_ENDPOINT = `${API_BASE}/buscadorSorteos`;
const GAME_ID = "ELGR";

const API_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "es-ES,es;q=0.9",
  Referer: REFERER,
};

const HTML_HEADERS = { "User-Agent": "Mozilla/5.0", "Accept-Language": "es-ES,es;q=0.9" };
const MAP_MESES = { ene: "01", feb: "02", mar: "03", abr: "04", may: "05", jun: "06", jul: "07", ago: "08", sep: "09", oct: "10", nov: "11", dic: "12" };

async function fetchSorteosOficial({ inicio, fin }) {
  if (!inicio || !fin) return [];
  const params = { game_id: GAME_ID, celebrados: "true", fechaInicioInclusiva: inicio, fechaFinInclusiva: fin };
  try {
    const { data } = await axios.get(BUSCADOR_ENDPOINT, { headers: API_HEADERS, params });
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function parseCombinacionOficial(combinacion) {
  const numeros = [];
  let numeroClave = "";
  if (!combinacion) return { numeros, numeroClave };
  const [soloNumeros] = combinacion.split(/R|Reintegro/i);
  const matches = soloNumeros?.match(/\d{1,2}/g) || [];
  for (const raw of matches.slice(0, 5)) {
    numeros.push(raw.padStart(2, "0"));
  }
  const claveMatch = combinacion.match(/R\s*\(?\s*(\d{1,2})\s*\)?/i) || combinacion.match(/Clave\D*(\d{1,2})/i);
  if (claveMatch) numeroClave = String(Number(claveMatch[1]));
  return { numeros, numeroClave };
}

function mapSorteoToResultadoGordo(entry) {
  if (!entry) return null;
  const fecha = (entry.fecha_sorteo || "").slice(0, 10);
  if (!fecha) return null;
  const { numeros, numeroClave } = parseCombinacionOficial(entry.combinacion);
  const result = {
    semana: isoWeekNumberOffset(fecha),
    sorteo: normalizarSorteo(entry.numero),
    fecha,
    numeros,
    numeroClave,
  };
  return isInvalidResultadoGordo(result) ? null : result;
}

async function scrapeResultadosGordoYearOficial(anio) {
  const year = Number(anio);
  if (!year) return [];
  const inicio = `${year}0101`;
  const fin = `${year}1231`;
  const sorteos = await fetchSorteosOficial({ inicio, fin });
  return sorteos.map(mapSorteoToResultadoGordo).filter(Boolean).sort((a, b) => a.fecha.localeCompare(b.fecha));
}

async function scrapeResultadosGordoYearFallback(anio) {
  const url = `https://www.elgordodelaprimitiva.com.es/gordoprimitiva/sorteos-${anio}.html`;
  const { data: html } = await axios.get(url, { headers: HTML_HEADERS });
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

    const sorteo = normalizarSorteo($(tds[0 + k]).text().trim());
    const fecha = convertirFechaCorta($(tds[2 + k]).text().trim(), MAP_MESES, { year: anio, replaceCharsWithA: /\?/g });

    const numeros = [];
    for (let i = 3 + k; i <= 7 + k; i++) {
      const v = $(tds[i]).text().trim();
      if (v) numeros.push(v);
    }
    const numeroClave = $(tds[8 + k])?.text().trim() || "";

    const item = { semana, sorteo, fecha, numeros, numeroClave };
    if (!isInvalidResultadoGordo(item)) out.push(item);
  });

  return out;
}

export async function scrapeResultadosGordoYear(anio) {
  const oficiales = await scrapeResultadosGordoYearOficial(anio);
  if (oficiales.length) return oficiales;
  try {
    return await scrapeResultadosGordoYearFallback(anio);
  } catch {
    return [];
  }
}

async function scrapeResultadoGordoDiaOficial(fechaISO) {
  const fechaParam = fechaParamFromISO(fechaISO);
  if (!fechaParam) return [];
  const sorteos = await fetchSorteosOficial({ inicio: fechaParam, fin: fechaParam });
  return sorteos.map(mapSorteoToResultadoGordo).filter(Boolean);
}

async function scrapeResultadoGordoDiaFallback(fechaISO) {
  const [Y, M, D] = fechaISO.split("-");
  const dia = `${D}-${M}-${Y}`;
  const urls = [
    `https://www.elgordodelaprimitiva.com.es/gordoprimitiva/Sorteo-${dia}.html`,
    `https://www.laprimitiva.info/gordo-primitiva/Sorteo-${dia}.html`,
  ];

  for (const url of urls) {
    try {
      const { data: html } = await axios.get(url, { headers: HTML_HEADERS });
      const $ = cheerio.load(html);
      const cand = [];
      $(".ball, .bola, .numero, .num, .n�mero").each((_, el) => {
        const t = $(el).text().trim();
        if (/^\d{1,2}$/.test(t)) cand.push(t.replace(/^0+/, "") || "0");
      });
      if (cand.length < 5) {
        const txt = $("body").text();
        const matches = txt.match(/\b(\d{1,2})\b/g) || [];
        matches.forEach((v) => cand.push(v.replace(/^0+/, "") || "0"));
      }
      const numeros = [];
      const seen = new Set();
      for (const v of cand) {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 1 && n <= 99 && !seen.has(n)) {
          numeros.push(String(n));
          seen.add(n);
          if (numeros.length === 5) break;
        }
      }
      let clave = "";
      const keyText = $("body").text();
      const m = keyText.match(/(N�\s*Clave|N\.?\s*Clave|Numero\s*Clave|N�mero\s*Clave|Clave)\D*(\d{1,2})/i);
      if (m) clave = String(Number(m[2]));

      let sorteo = "";
      const srt = keyText.match(/Sorteo\s*(\d{1,3})/i);
      if (srt) sorteo = srt[1].padStart(3, "0");
      if (!sorteo) {
        const week = getISOWeek(new Date(fechaISO));
        sorteo = String(week).padStart(3, "0");
      }

      if (numeros.length === 5 && clave) {
        const semana = getISOWeek(new Date(fechaISO));
        return [{ semana, sorteo, fecha: fechaISO, numeros, numeroClave: clave }];
      }
    } catch {
      // continue
    }
  }
  return [];
}

export async function scrapeResultadoGordoDia(fechaISO) {
  const oficiales = await scrapeResultadoGordoDiaOficial(fechaISO);
  if (oficiales.length) return oficiales;
  return scrapeResultadoGordoDiaFallback(fechaISO);
}

export async function getResultadoGordo(fechaISO) {
  const items = await scrapeResultadoGordoDia(fechaISO);
  if (!items || !items.length) return false;
  const mariadb = await import("mariadb");
  const pool = mariadb.default.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    connectionLimit: 2,
  });
  const conn = await pool.getConnection();
  try {
    for (const r of items) {
      await conn.query(
        `INSERT INTO r_gordo (semana, sorteo, fecha, numeros, numeroClave)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE numeros=VALUES(numeros), numeroClave=VALUES(numeroClave)`,
        [r.semana || 0, r.sorteo || "", r.fecha, (r.numeros || []).join(","), r.numeroClave]
      );
    }
    return true;
  } catch {
    return false;
  } finally {
    try {
      conn.release();
      await pool.end();
    } catch {}
  }
}

function aciertosFromCategoriaGordo(cat) {
  const m = cat.match(/\(([^)]+)\)/);
  if (!m) return "";
  return m[1].replace(/\s+/g, "").replace(/Clave/gi, "C");
}

const GORDO_CATEGORIA_MAP = {
  1: { categoria: "1\u00AA (5 Aciertos+C)", aciertos: "5+C" },
  2: { categoria: "2\u00AA (5 Aciertos)", aciertos: "5" },
  3: { categoria: "3\u00AA (4 Aciertos+C)", aciertos: "4+C" },
  4: { categoria: "4\u00AA (4 Aciertos)", aciertos: "4" },
  5: { categoria: "5\u00AA (3 Aciertos+C)", aciertos: "3+C" },
  6: { categoria: "6\u00AA (3 Aciertos)", aciertos: "3" },
  7: { categoria: "7\u00AA (2 Aciertos+C)", aciertos: "2+C" },
  8: { categoria: "8\u00AA (2 Aciertos)", aciertos: "2" },
  9: { categoria: "Reintegro", aciertos: "R" },
};

function mapEscrutinioRow(row) {
  if (!row) return null;
  const catNum = Number(row.categoria);
  const meta = GORDO_CATEGORIA_MAP[catNum] || null;
  const categoria = meta?.categoria || normalizaOrdinal(row.tipo || "");
  const aciertos = meta?.aciertos || aciertosFromCategoriaGordo(categoria);
  if (!aciertos) return null;
  return {
    categoria,
    aciertos,
    premio: parseEuroToFloat(row.premio),
    premio_text: formatPremioText(row.premio),
  };
}

async function persistPremiosGordo(premios, fechaISO, sorteoHint) {
  if (!premios || !premios.length) return;
  const mariadb = await import("mariadb");
  const pool = mariadb.default.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    connectionLimit: 2,
  });
  const conn = await pool.getConnection();
  try {
    let sorteoNNN = sorteoHint ? normalizarSorteo(sorteoHint) : "";
    if (!sorteoNNN) {
      const rows = await conn.query("SELECT sorteo FROM r_gordo WHERE fecha = ? LIMIT 1", [fechaISO]);
      if (rows.length) sorteoNNN = normalizarSorteo(rows[0].sorteo);
    }
    if (!sorteoNNN) return;
    for (const p of premios) {
      await conn.query(
        `INSERT INTO premios_sorteos (tipoApuesta, sorteo, fecha, categoria, aciertos, premio, premio_text)
         VALUES ('gordo', ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE premio=VALUES(premio), premio_text=VALUES(premio_text), categoria=VALUES(categoria)`,
        [sorteoNNN, fechaISO, p.categoria, p.aciertos || "", Number(p.premio || 0), p.premio_text || ""]
      );
    }
  } finally {
    try {
      conn.release();
      await pool.end();
    } catch {}
  }
}

async function scrapePremiosGordoOficial(fechaISO) {
  const fechaParam = fechaParamFromISO(fechaISO);
  if (!fechaParam) return [];
  const sorteos = await fetchSorteosOficial({ inicio: fechaParam, fin: fechaParam });
  const entry = Array.isArray(sorteos) && sorteos.length ? sorteos[0] : null;
  if (!entry || !Array.isArray(entry.escrutinio)) return [];
  const premios = entry.escrutinio.map(mapEscrutinioRow).filter(Boolean);
  if (!premios.length) return [];
  await persistPremiosGordo(premios, fechaISO, entry.numero);
  return premios;
}

function parseTablaPremios($) {
  const tabla = $("table")
    .filter((_, el) => {
      const heads = $(el)
        .find("th")
        .map((__, th) => $(th).text().toLowerCase().trim())
        .get()
        .join(" ");
      return heads.includes("categor") && heads.includes("importe");
    })
    .first();
  const premios = [];
  if (!tabla.length) return premios;
  tabla.find("tbody tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 2) return;
    const catRaw = $(tds[0]).text().trim();
    const premRaw = $(tds[tds.length - 1]).text().trim();
    if (!filaPremioValida(catRaw, premRaw)) return;
    const categoriaRaw = normalizaOrdinal(catRaw);
    let aciertos = "";
    if (/reintegro/i.test(categoriaRaw) && !/\(/.test(categoriaRaw)) aciertos = "R";
    else {
      const inside = categoriaRaw.match(/\(([^)]+)\)/);
      if (inside) {
        aciertos = inside[1].replace(/\s+/g, "").replace(/\+1/g, "+C").replace(/\+0/g, "").replace(/Clave/gi, "C");
      }
    }
    const allowed = new Set(["5+C", "5", "4+C", "4", "3+C", "3", "2+C", "2", "R"]);
    if (!allowed.has(aciertos)) return;
    const map = {
      "5+C": "1\u00AA (5 Aciertos+C)",
      "5": "2\u00AA (5 Aciertos)",
      "4+C": "3\u00AA (4 Aciertos+C)",
      "4": "4\u00AA (4 Aciertos)",
      "3+C": "5\u00AA (3 Aciertos+C)",
      "3": "6\u00AA (3 Aciertos)",
      "2+C": "7\u00AA (2 Aciertos+C)",
      "2": "8\u00AA (2 Aciertos)",
      R: "Reintegro",
    };
    premios.push({
      categoria: map[aciertos] || categoriaRaw,
      aciertos,
      premio: parseEuroToFloat(premRaw),
      premio_text: premRaw,
    });
  });
  return premios;
}

async function scrapePremiosGordoFallback(fechaISO) {
  const [Y, M, D] = fechaISO.split("-");
  const dia = `${D}-${M}-${Y}`;
  const urls = [
    `https://www.elgordodelaprimitiva.com.es/gordoprimitiva/Sorteo-${dia}.html`,
    `https://www.laprimitiva.info/gordo-primitiva/Sorteo-${dia}.html`,
  ];
  for (const url of urls) {
    try {
      const { data: html } = await axios.get(url, { headers: HTML_HEADERS });
      const $ = cheerio.load(html);
      const premios = parseTablaPremios($);
      if (premios.length) {
        await persistPremiosGordo(premios, fechaISO);
        return premios;
      }
    } catch {
      // continue
    }
  }
  return [];
}

export async function scrapePremiosGordoByFecha(fechaISO) {
  const oficiales = await scrapePremiosGordoOficial(fechaISO);
  if (oficiales.length) return oficiales;
  return scrapePremiosGordoFallback(fechaISO);
}
