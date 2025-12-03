import { format } from "date-fns";

const DEFAULT_TZ = "Europe/Madrid";
const APP_TZ = process.env.TZ || DEFAULT_TZ;
if (!process.env.TZ) process.env.TZ = APP_TZ;

export function ensureAppTimezone() {
  return APP_TZ;
}

// ======== FECHAS LOCAL (evitar UTC) ========
export function todayISO() {
  return fechaISO(new Date());
}

export function nowDateTimeISO() {
  return format(new Date(), "yyyy-MM-dd HH:mm:ss");
}
export function parseISODateLocal(iso) {
  if (!iso) return new Date(NaN);
  // Si ya es Date, normaliza a medianoche local (evita UTC)
  if (iso instanceof Date) {
    const dt = iso;
    if (Number.isNaN(dt.getTime())) return new Date(NaN);
    return new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
  }
  if (typeof iso === "string") {
    const s = iso.trim();
    // Soporta "YYYY-MM-DD" y variantes con hora/zona (toma solo la parte de fecha)
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) {
      // Acepta también sin ceros a la izquierda: YYYY-M-D
      m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    }
    if (m) {
      const y = Number(m[1]);
      const mm = Number(m[2]);
      const dd = Number(m[3]);
      return new Date(Date.UTC(y, (mm || 1) - 1, dd || 1));
    }
    // Último recurso: que JS la parsee y luego normalizamos a fecha local
    const dt = new Date(s);
    if (!Number.isNaN(dt.getTime())) {
      return new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
    }
  }
  return new Date(NaN);
}
export function fechaISO(d) {
  const dt = d instanceof Date ? d : parseISODateLocal(d);
  if (Number.isNaN(dt.getTime())) return "";
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function addDays(dateISO, days) {
  const d = parseISODateLocal(dateISO);
  d.setDate(d.getDate() + days);
  return fechaISO(d);
}
export function weekday(dateISO) {
  return parseISODateLocal(dateISO).getDay(); // 0..6 (0=Dom)
}
export function mondayOf(dateISO) {
  const d = parseISODateLocal(dateISO);
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  return fechaISO(d);
}
export function enumerateMondaysInRange(inicioISO, finISO) {
  let cur = parseISODateLocal(mondayOf(inicioISO));
  const end = parseISODateLocal(mondayOf(finISO));
  const res = [];
  while (cur <= end) {
    res.push(fechaISO(cur));
    cur.setDate(cur.getDate() + 7);
  }
  return res;
}
