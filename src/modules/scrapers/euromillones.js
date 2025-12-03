import axios from "axios";
import { parseISO } from "date-fns";
import {
  fechaParamFromISO,
  parseEuroToFloat,
  formatPremioText,
  normalizaOrdinal,
  normalizarSorteo,
  isoWeekNumberOffset,
  isInvalidResultadoEurom,
} from "./common.js";

const REFERER = "https://www.loteriasyapuestas.es/es/resultados/euromillones";
const API_BASE = "https://www.loteriasyapuestas.es/servicios";
// Los endpoints públicos de SELAE devuelven JSON idéntico al que consume la web oficial.
const EUROM_ENDPOINT = `${API_BASE}/buscadorSorteos`;
const GAME_ID = "EMIL";
const WEEK_OFFSET = Number(process.env.EUROM_SEMANA_OFFSET ?? "0");

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "es-ES,es;q=0.9",
  Referer: REFERER,
};

async function fetchSorteos({ inicio, fin }) {
  const params = {
    game_id: GAME_ID,
    celebrados: "true",
    fechaInicioInclusiva: inicio,
    fechaFinInclusiva: fin,
  };
  const { data } = await axios.get(EUROM_ENDPOINT, { headers: HEADERS, params });
  if (!Array.isArray(data)) return [];
  return data;
}

function parseCombinacion(combinacion) {
  const parts = (combinacion || "").match(/\d+/g) || [];
  const numeros = parts.slice(0, 5).map(n => n.padStart(2, "0"));
  const estrellas = parts.slice(5).map(n => n.padStart(2, "0"));
  return { numeros, estrellas };
}

function mapSorteoToResultadoEurom(entry) {
  if (!entry) return null;
  const fecha = (entry.fecha_sorteo || "").slice(0, 10);
  if (!fecha) return null;
  const { numeros, estrellas } = parseCombinacion(entry.combinacion);
  const result = {
    semana: isoWeekNumberOffset(fecha, WEEK_OFFSET),
    sorteo: normalizarSorteo(entry.numero),
    fecha,
    numeros,
    estrellas,
    elMillon: entry?.millon?.combinacion?.trim() || "",
  };
  return isInvalidResultadoEurom(result) ? null : result;
}

// ========== RESULTADOS (AÑO) ==========
async function scrapeResultadosEuromillonesYear(anio) {
  const year = Number(anio);
  if (!year || year < 2004) return [];
  const inicio = `${year}0101`;
  const fin = `${year}1231`;
  const sorteos = await fetchSorteos({ inicio, fin });
  return sorteos
    .map(mapSorteoToResultadoEurom)
    .filter(Boolean)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

// Modo dual: si recibe año => array anual; si recibe fecha ISO => inserta/actualiza ese día en BD
export async function scrapeResultadosEuromillonesByFecha(input) {
  const isFecha = typeof input === "string" && /\d{4}-\d{2}-\d{2}/.test(input);
  if (!isFecha) {
    const anio = Number(input);
    return scrapeResultadosEuromillonesYear(anio);
  }

  const fechaISO = input;
  const fechaParam = fechaParamFromISO(fechaISO);
  const sorteos = await fetchSorteos({ inicio: fechaParam, fin: fechaParam });
  const r = mapSorteoToResultadoEurom(sorteos[0]);
  if (!r) return false;

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
    await conn.query(
      `INSERT INTO r_euromillones (semana, sorteo, fecha, numeros, estrellas, elMillon)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE numeros=VALUES(numeros), estrellas=VALUES(estrellas), elMillon=VALUES(elMillon)`,
      [r.semana || "", r.sorteo || "", r.fecha, (r.numeros || []).join(","), (r.estrellas || []).join(","), r.elMillon || ""]
    );
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

// ========== PREMIOS (por fecha) ==========
function aciertosFromCategoriaEuro(cat) {
  if (!cat) return "";
  const inParens = cat.match(/\(([^)]+)\)/);
  if (inParens) return inParens[1].replace(/\s+/g, "");
  const plus = cat.replace(/\s+/g, "").match(/(\d+)\+(\d+)/);
  if (plus) return `${plus[1]}+${plus[2]}`;
  const solo = cat.match(/(\d+)\s*aciertos/i);
  if (solo) return solo[1];
  return "";
}

export async function scrapePremiosEuromillonesByFecha(fechaISO) {
  const fechaParam = fechaParamFromISO(fechaISO);
  const sorteos = await fetchSorteos({ inicio: fechaParam, fin: fechaParam });
  const entry = sorteos[0];
  if (!entry || !Array.isArray(entry.escrutinio)) return [];
  const premios = entry.escrutinio.map(row => {
    const base = (row.tipo || "").replace(/\s+/g, " ").trim();
    const categoria = normalizaOrdinal(base);
    return {
      categoria,
      aciertos: aciertosFromCategoriaEuro(base),
      premio: parseEuroToFloat(row.premio),
      premio_text: formatPremioText(row.premio),
    };
  });
  const sorteoNNN = normalizarSorteo(entry.numero);
  if (sorteoNNN && premios.length) {
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
      for (const p of premios) {
        await conn.query(
          `INSERT INTO premios_sorteos (tipoApuesta, sorteo, fecha, categoria, aciertos, premio, premio_text)
           VALUES ('euromillones', ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE premio=VALUES(premio), premio_text=VALUES(premio_text), categoria=VALUES(categoria)`,
          [sorteoNNN, fechaISO, p.categoria, p.aciertos, Number(p.premio || 0), p.premio_text || ""]
        );
      }
    } finally {
      try {
        conn.release();
        await pool.end();
      } catch {}
    }
  }
  return premios;
}
