import axios from "axios";
import { addDays, format } from "date-fns";

const API_BASE = "https://www.loteriasyapuestas.es/servicios";
const BUSCADOR_ENDPOINT = `${API_BASE}/buscadorSorteos`;
const PROXIMOS_ENDPOINT = `${API_BASE}/proximosv3`;
const BASE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "es-ES,es;q=0.9",
  Referer: "https://www.loteriasyapuestas.es/es",
};

const GAME_CONFIG = {
  euromillones: {
    id: "EMIL",
    label: "Euromillones",
    referer: "https://www.loteriasyapuestas.es/es/resultados/euromillones",
  },
  primitiva: {
    id: "LAPR",
    label: "Primitiva",
    referer: "https://www.loteriasyapuestas.es/es/resultados/primitiva",
  },
  gordo: {
    id: "ELGR",
    label: "El Gordo",
    referer: "https://www.loteriasyapuestas.es/es/resultados/gordo-primitiva",
  },
};

function formatRangeDate(date) {
  return format(date, "yyyyMMdd");
}

function parseFecha(fecha) {
  if (!fecha) return null;
  const iso = fecha.replace(" ", "T");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function fetchBuscador({ gameId, referer, inicio, fin, celebrados }) {
  if (!gameId || !inicio || !fin) return [];
  const headers = { ...BASE_HEADERS, Referer: referer || BASE_HEADERS.Referer };
  const params = {
    game_id: gameId,
    celebrados: celebrados ? "true" : "false",
    fechaInicioInclusiva: inicio,
    fechaFinInclusiva: fin,
  };
  try {
    const { data } = await axios.get(BUSCADOR_ENDPOINT, { headers, params, timeout: 8000 });
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function fetchProximos({ gameId, referer, num = 4 }) {
  if (!gameId) return [];
  const headers = { ...BASE_HEADERS, Referer: referer || BASE_HEADERS.Referer };
  const params = { game_id: gameId, num };
  try {
    const { data } = await axios.get(PROXIMOS_ENDPOINT, { headers, params, timeout: 8000 });
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function normalizarSorteoNumero(num) {
  if (num == null) return "";
  const n = Number(num);
  if (Number.isFinite(n)) return String(n).padStart(3, "0");
  const match = num.toString().match(/\d+/);
  return match ? match[0].padStart(3, "0") : "";
}

function buildBoteObject(cfg, info, origen) {
  if (!info) return null;
  const premio = Number(info.premio ?? info.premio_bote ?? info.premioBote ?? 0);
  if (!Number.isFinite(premio) || premio <= 0) return null;
  return {
    nombre: cfg.label,
    fecha: (info.fecha || "").slice(0, 10),
    sorteo: normalizarSorteoNumero(info.sorteo),
    premio,
    origen,
  };
}

async function obtenerBoteJuego(cfg) {
  const now = new Date();
  const startFuture = formatRangeDate(now);
  const endFuture = formatRangeDate(addDays(now, 21));
  const proximos = await fetchProximos({ gameId: cfg.id, referer: cfg.referer, num: 6 });
  const proximosOrdenados = proximos
    .map((p) => ({ ...p, fechaOrden: parseFecha(p.fecha) || new Date(0) }))
    .sort((a, b) => a.fechaOrden - b.fechaOrden);
  const abierto = proximosOrdenados.find(
    (p) => p.estado === "abierto" && (Number(p.premio_bote) || 0) > 0
  );
  if (abierto) {
    return buildBoteObject(
      cfg,
      {
        fecha: abierto.fecha,
        sorteo: abierto.numero || abierto.cdc,
        premio: abierto.premio_bote,
      },
      abierto
    );
  }

  let sorteos = await fetchBuscador({
    gameId: cfg.id,
    referer: cfg.referer,
    inicio: startFuture,
    fin: endFuture,
    celebrados: false,
  });
  sorteos = sorteos
    .filter((s) => (Number(s.premio_bote) || 0) > 0)
    .sort((a, b) => {
      const da = parseFecha(a.fecha_sorteo) || new Date(0);
      const db = parseFecha(b.fecha_sorteo) || new Date(0);
      return da - db;
    });
  const nowTs = now.getTime();
  let objetivo = sorteos.find((s) => {
    const d = parseFecha(s.fecha_sorteo);
    return d && d.getTime() >= nowTs - 6 * 60 * 60 * 1000;
  });

  if (!objetivo) return null;
  return buildBoteObject(
    cfg,
    {
      fecha: objetivo.fecha_sorteo,
      sorteo: objetivo.numero,
      premio: objetivo.premio_bote,
    },
    objetivo
  );
}

export async function getBotesActuales() {
  const entries = await Promise.all(
    Object.entries(GAME_CONFIG).map(async ([key, cfg]) => {
      const data = await obtenerBoteJuego(cfg);
      return [key, data];
    })
  );
  return Object.fromEntries(entries);
}
