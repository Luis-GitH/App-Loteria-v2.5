// ================================================
// 📦 parse_ticket_qr.js (versión final)
// ------------------------------------------------
// Convierte un texto QR de boleto en un objeto JSON
// Incluye fechas de sorteos, lunes de la semana y campos específicos.
// Compatible con Primitiva, Euromillones y El Gordo.
// ================================================

// --- Meses ---
import { ensureAppTimezone, fechaISO } from "../helpers/fechas.js";
ensureAppTimezone();

const MES_A_NUM = {
  ENE: 0, FEB: 1, MAR: 2, ABR: 3, MAY: 4, JUN: 5,
  JUL: 6, AGO: 7, SEP: 8, OCT: 9, NOV: 10, DIC: 11,
};

// --- Días según tipo de boleto ---
function diasPorTipo(tipo) {
  tipo = tipo.toLowerCase();
  if (tipo === "primitiva") return ["lunes", "jueves", "sábado"];
  if (tipo === "euromillones") return ["martes", "viernes"];
  if (tipo === "gordo") return ["domingo"];
  return ["lunes"];
}

// --- Día de la semana a partir de fecha ---
function siguienteFechaDesde(base, diaBuscado) {
  const dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const idxBuscado = dias.indexOf(diaBuscado.toLowerCase());
  const fecha = new Date(base);
  while (fecha.getDay() !== idxBuscado) {
    fecha.setDate(fecha.getDate() + 1);
  }
  return fecha;
}

// --- Calcular lunes de la semana ---
function lunesDeSemana(fecha) {
  const dia = fecha.getDay();
  const dif = dia === 0 ? -6 : 1 - dia;
  const lunes = new Date(fecha);
  lunes.setDate(fecha.getDate() + dif);
  return lunes;
}

// =============================================
// 📅 Calcular fechas de sorteo
// =============================================
function calcularFechasSorteo(campoS, tipo, semanas = 1) {
  // formato: S=sssddMMMyy:n
  const m = campoS.match(/(\d{3})(\d{2})([A-Z]{3})(\d{2}):(\d+)/);
  if (!m) {
    console.warn("⚠️ Formato S= no reconocido:", campoS);
    return [];
  }
if (tipo == "gordo") {
  console.log(tipo);
};
  const sorteoBase = parseInt(m[1], 10);
  const dia = parseInt(m[2], 10);
  const mesTxt = m[3];
  const anio = 2000 + parseInt(m[4], 10);
  const numSorteos = parseInt(m[5], 10) || semanas || 1;

  const mes = MES_A_NUM[mesTxt] ?? 0;
  const fechaBase = new Date(anio, mes, dia);
  const agenda = diasPorTipo(tipo);

  const resultados = [];
  let sorteo = sorteoBase;

  for (let i = 0; i < numSorteos; i++) {
    const diaTexto = agenda[i % agenda.length];
    const candidata = siguienteFechaDesde(fechaBase, diaTexto);
    const lunes = lunesDeSemana(candidata);

    const fecha = fechaISO(candidata);
    const lunesSem = fechaISO(lunes);

    resultados.push({
      sorteo,
      fecha,
      dia: diaTexto,
      lunesSemana: lunesSem,
    });

    // avanzar sorteo y fecha base
    candidata.setDate(candidata.getDate() + 1);
    fechaBase.setDate(fechaBase.getDate() + 1);
    sorteo++;
  }

  return resultados;
}

// =============================================
// 🧩 Parser principal  parsea el qr entregado
// =============================================
export function parseTicketQR(contenidoQR) {
  try {
    if (!contenidoQR || !contenidoQR.includes(";")) return null;

    const partes = contenidoQR.split(";");
    const boleto = {
      identificador: "",
      tipo: "",
      sorteoCodigo: "",
      sorteos: [],
      fechaLunes: "",
      combinacion: "",
      estrellas: "",
      reintegro: "",
      clave: "",
      millon: "",
      semanas: 1,
      terminal: "",
      joker: "",
    };

    for (const campo of partes) {
      if (campo.startsWith("A=")) boleto.identificador = campo.slice(2);
      else if (campo.startsWith("P=")) {
        const val = campo.slice(2);
        if (val === "1") boleto.tipo = "primitiva";
        else if (val === "4") boleto.tipo = "gordo";
        else if (val === "7") boleto.tipo = "euromillones";
      } else if (campo.startsWith("S=")) {
        boleto.sorteoCodigo = campo.slice(2);
      } else if (campo.startsWith("W=")) {
        boleto.semanas = parseInt(campo.slice(2)) || 1;
      } else if (campo.startsWith(".1=")) {
        const val = campo.slice(3);
        const partes = val.split(":");
        boleto.combinacion = partes[0] || "";
        if (boleto.tipo === "primitiva") boleto.reintegro = partes[1] || "";
        else if (boleto.tipo === "euromillones") boleto.estrellas = partes[1] || "";
        else if (boleto.tipo === "gordo") boleto.clave = partes[1] || "";
      } else if (campo.startsWith("T=")) boleto.terminal = campo.slice(2);
      else if (campo.startsWith("R=")) boleto.reintegro = campo.slice(2);
      else if (campo.startsWith("J=")) boleto.joker = campo.slice(2);
      else if (campo.startsWith("RI=") && boleto.tipo === "euromillones") {
        const riMatch = campo.match(/RI=.*\[.*?([A-Za-z0-9]{8})\]/);
        boleto.millon = riMatch ? riMatch[1] : "";
      }
    }

    // Calculamos los sorteos después de tener todos los datos
    if (boleto.sorteoCodigo && boleto.tipo) {
      const fechas = calcularFechasSorteo(boleto.sorteoCodigo, boleto.tipo, boleto.semanas);
      boleto.sorteos = fechas;
      if (fechas.length > 0) boleto.fechaLunes = fechas[0].lunesSemana;
    }

    return boleto;
  } catch (err) {
    console.error("❌ Error parseando QR:", err.message);
    return null;
  }
}
