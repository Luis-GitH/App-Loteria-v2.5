const EURO_LOCALE = "es-ES";

export function fechaParamFromISO(fechaISO) {
  return (fechaISO || "").replace(/-/g, "");
}

export function parseEuroToFloat(txt) {
  if (!txt) return 0;
  const n = parseFloat(txt.replace(/[?.]/g, "").replace(",", "."));
  return Number.isNaN(n) ? 0 : n;
}

export function formatPremioText(value) {
  const num = parseEuroToFloat(value);
  if (!Number.isFinite(num)) return (value || "").toString().trim();
  return num
    .toLocaleString(EURO_LOCALE, {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
    })
    .replace(/\u00A0/g, " ");
}

export function normalizaOrdinal(cat) {
  return (cat || "")
    .toString()
    .replace(/\b(\d+)(?:a|\u00AA)\b/gi, (_, num) => `${num}\u00AA`)
    .replace(/\b(\d+)(?:o|\u00BA)\b/gi, (_, num) => `${num}\u00BA`)
    .replace(/\s+/g, " ")
    .trim();
}

export function filaPremioValida(categoria, premioTxt) {
  if (!categoria || !premioTxt) return false;
  const low = categoria.toLowerCase();
  if (low.includes("recaud") || low.includes("destinado") || low.includes("total")) return false;
  if (!/[€?]/.test(premioTxt)) return false; // admite "?" por issues de encoding en scrapes
  if (/^\d{1,3}(\.\d{3})*,\d{2}\s*?$/.test(categoria.trim())) return false;
  return true;
}

export function normalizarSorteo(s, { preferSlashTail = false } = {}) {
  const str = (s ?? "").toString().trim();
  if (preferSlashTail && str.includes("/")) {
    const tail = str.split("/")[1]?.trim();
    if (tail) return tail.padStart(3, "0");
  }
  const m = str.match(/\d+/);
  return m ? m[0].padStart(3, "0") : str;
}

export function isoWeekNumberOffset(fechaISO, offset = 0) {
  if (!fechaISO) return "";
  const date = new Date(`${fechaISO}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  let week = getISOWeek(date);
  if (!offset) return String(week);
  const weeksCurrentYear = getISOWeeksInYear(date);
  let adjusted = week + offset;
  if (adjusted > weeksCurrentYear) adjusted -= weeksCurrentYear;
  else if (adjusted < 1) {
    const weeksPrevYear = getISOWeeksInYear(subYears(date, 1));
    adjusted += weeksPrevYear;
  }
  return String(adjusted);
}

export function convertirFechaCorta(fechaTexto, mapMeses, { replaceCharsWithA = /[�\?]/g, year } = {}) {
  const cleaned = (fechaTexto || "").trim().toLowerCase().replace(replaceCharsWithA, "a");
  const m = cleaned.match(/^(\d{1,2})-([a-z]{3,})$/i);
  if (!m) return "";
  const dia = m[1].padStart(2, "0");
  const mes = mapMeses[m[2]] || "01";
  const y = year ?? new Date().getFullYear();
  return `${y}-${mes}-${dia}`;
}

export function isInvalidResultadoEurom(item) {
  if (!item.numeros || item.numeros.length !== 5) return true;
  if (!item.estrellas || item.estrellas.length !== 2) return true;
  if (!item.elMillon || !item.elMillon.trim()) return true;
  return false;
}

export function isInvalidResultadoGordo(item) {
  if (!item.numeros || item.numeros.length !== 5) return true;
  if (!item.numeroClave) return true;
  return false;
}

export function isInvalidResultadoPrimitiva(item) {
  if (!item.numeros || item.numeros.length !== 6) return true;
  if (!item.complementario || !item.reintegro) return true;
  return false;
}
import { getISOWeek, getISOWeeksInYear, subYears } from "date-fns";
