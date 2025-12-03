import axios from "axios"; // 🆕
import * as cheerio from "cheerio"; // 🆕
import { format } from "date-fns";
import { parseISODateLocal, fechaISO as fechaISO_Local } from "./fechas.js";

/// Helpers (colócalos tras tus comparadores o donde prefieras)

// 🆕 Normaliza cabeceras y textos
const norm = (s) =>
    (s || "")
        .toString()
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "");

// 🆕 Convierte "11,58 €" -> {num: 11.58, txt: "11,58 €"}
function parseMoney(s) {
    const txt = (s || "").toString().trim();
    const n = txt
        .replace(/\./g, "")
        .replace(",", ".")
        .replace(/[^\d.]/g, "");
    const num = parseFloat(n || "0") || 0;
    return { num, txt };
}

// 🆕 Construcción de URLs por juego a partir de la fecha del sorteo
function toDDMMYYYY(dateStr) {
    const d = parseISODateLocal(dateStr);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return { dd, mm, yyyy };
}
function diaSemanaES(dateStr) {
    const dias = [
        "domingo",
        "lunes",
        "martes",
        "miercoles",
        "jueves",
        "viernes",
        "sabado",
    ];
    return dias[parseISODateLocal(dateStr).getDay()];
}

// Primitiva (confirmado por ti): Sorteo-dd-mm-yyyy-diadelasemana.html
function urlPremiosPrimitiva(fechaISO) {
    const { dd, mm, yyyy } = toDDMMYYYY(fechaISO);
    const dia = diaSemanaES(fechaISO);
    return `https://www.laprimitiva.info/loteriaprimitiva/Sorteo-${dd}-${mm}-${yyyy}-${dia}.html`;
}

// Gordo (confirmado por ti): Sorteo-dd-mm-yyyy.html
function urlPremiosGordo(fechaISO) {
    const { dd, mm, yyyy } = toDDMMYYYY(fechaISO);
    return `https://www.laprimitiva.info/gordo-primitiva/Sorteo-${dd}-${mm}-${yyyy}.html`;
}

// Euromillones: no nos diste patrón exacto; intentamos este.
// Si tuvieras otro, ponlo en .env como PREM_EURO_URL="https://.../Sorteo-{dd}-{mm}-{yyyy}.html"
function urlPremiosEuromillones(fechaISO) {
    const tpl = process.env.PREM_EURO_URL; // opcional
    const { dd, mm, yyyy } = toDDMMYYYY(fechaISO);
    if (tpl)
        return tpl
            .replace("{dd}", dd)
            .replace("{mm}", mm)
            .replace("{yyyy}", yyyy);
    // fallback razonable (ajústalo si hace falta):
    return `https://www.euromillones.com.es/euromillones/Sorteo-${dd}-${mm}-${yyyy}.html`;
}
function fechaLargaES(fechaISO) {
    const d = parseISODateLocal(fechaISO);
    const dias = [
        "domingo",
        "lunes",
        "martes",
        "miércoles",
        "jueves",
        "viernes",
        "sábado",
    ];
    const meses = [
        "enero",
        "febrero",
        "marzo",
        "abril",
        "mayo",
        "junio",
        "julio",
        "agosto",
        "septiembre",
        "octubre",
        "noviembre",
        "diciembre",
    ];
    const dia = dias[d.getDay()];
    const dd = d.getDate();
    const mm = meses[d.getMonth()];
    const yyyy = d.getFullYear();
    return `${dia}, ${dd} de ${mm} de ${yyyy}`;
}

// Devuelve el hash (data-sorteo) para una fecha concreta
async function resolverHashEuromillones(fechaISO) {
    const URL = "https://www.euromillones.com.es/resultados-anteriores.html";
    const { data: html } = await axios.get(URL, {
        headers: {
            "User-Agent": "Mozilla/5.0",
            "Accept-Language": "es-ES,es;q=0.9",
        },
    });
    const $ = cheerio.load(html);

    // El H4 viene así: "Euromillones - viernes, 17 de octubre de 2025"
    const needle = fechaLargaES(fechaISO); // "viernes, 17 de octubre de 2025"

    // Recorremos cada bloque de sorteo
    let hash = null;
    $("#sorteosant .listado > li").each((_, li) => {
        const h4 = $(li)
            .find(".combisa .numestre h4")
            .text()
            .trim()
            .toLowerCase();
        if (!h4) return;
        // normalizamos
        const norm = h4.normalize("NFD").replace(/\p{Diacritic}/gu, "");
        const buscar = `euromillones - ${needle}`
            .toLowerCase()
            .normalize("NFD")
            .replace(/\p{Diacritic}/gu, "");
        if (norm.includes(buscar)) {
            const panel = $(li).find(".cargar[data-sorteo]");
            const h = panel.attr("data-sorteo");
            if (h) hash = h;
        }
    });

    return hash; // puede ser null si no lo encuentra
}
async function fetchPremiosHtmlEuromillones(hash) {
    if (!hash) return "";
    const { data: html } = await axios.post(
        "https://www.euromillones.com.es/historial.php",
        `data=${encodeURIComponent(hash)}`,
        {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "Mozilla/5.0",
                "Accept-Language": "es-ES,es;q=0.9",
                Origin: "https://www.euromillones.com.es",
                Referer:
                    "https://www.euromillones.com.es/resultados-anteriores.html",
            },
        }
    );
    return html || "";
}
function parsePremiosEuromillones(html) {
    const $ = cheerio.load(html);
    const res = []; // [{ categoria, aciertos, premio_num, premio_txt }]
    // Busca una tabla que tenga "Categoría" y "Importe del Premio"
    const tabla = $("table")
        .filter((_, el) => {
            const headers = $(el)
                .find("th")
                .map((__, th) => $(th).text().toLowerCase().trim())
                .get();
            return (
                headers.some((h) => h.includes("categor")) &&
                headers.some((h) => h.includes("importe"))
            );
        })
        .first();
    if (!tabla.length) return res;

    tabla.find("tbody tr").each((_, tr) => {
        const tds = $(tr).find("td");
        if (!tds.length) return;
        const categoriaRaw = $(tds[0]).text().trim(); // "1ª (5 + 2)"
        const premioRaw = $(tds[tds.length - 1])
            .text()
            .trim(); // "234.122,00 €" etc.

        // Filtrar filas como "RECAUDACIÓN", etc.
        const lower = categoriaRaw.toLowerCase();
        if (
            !categoriaRaw ||
            lower.includes("recaud") ||
            lower.includes("destinado") ||
            lower.includes("total")
        )
            return;

        // FORMATO B: guardamos categoría completa (con aciertos)
        const categoria = categoriaRaw
            .replace(/\s+/g, " ") // normaliza espacios
            .replace("º", "ª")
            .trim();

        // Extraer aciertos solo si te interesa (separado)
        const aciertosMatch = categoriaRaw.match(/\(([^)]+)\)/);
        const aciertosTxt = aciertosMatch
            ? aciertosMatch[1].replace(/\s+/g, "")
            : "";

        // Premio a número
        const premioNum = parseFloat(
            premioRaw.replace(/[€.]/g, "").replace(",", ".")
        );

        res.push({
            categoria, // "1ª (5 + 2)"
            aciertos: aciertosTxt, // "5+2"
            premio_num: isNaN(premioNum) ? 0 : premioNum,
            premio_txt: premioRaw, // "234.122,00 €"
        });
    });

    // Normaliza categorías del Gordo a texto canónico y códigos de aciertos
    for (let i = 0; i < res.length; i++) {
        const item = res[i];
        const raw = (item.categoria || "").toString();
        const low = raw.toLowerCase();
        let code = "";
        if (low.includes("reintegro") && !/(\d)/.test(low)) {
            code = "R";
        } else {
            const m = raw.match(/\(([^)]+)\)/);
            if (m) code = m[1].replace(/\s+/g, "").replace(/Clave/gi, "C");
        }
        const mapa = {
            "5+C": "1ª (5 Aciertos+C)",
            5: "2ª (5 Aciertos)",
            "4+C": "3ª (4 Aciertos+C)",
            4: "4ª (4 Aciertos)",
            "3+C": "5ª (3 Aciertos+C)",
            3: "6ª (3 Aciertos)",
            "2+C": "7ª (2 Aciertos+C)",
            2: "8ª (2 Aciertos)",
            R: "Reintegro",
        };
        if (code && mapa[code]) {
            item.categoria = mapa[code];
            item.aciertos = code;
        }
        res[i] = item;
    }

    return res;
}

/**
 * Extrae tabla de premios desde HTML y devuelve Map { categoria -> importe }
 * Normaliza categorías a formato "1ª", "2ª", etc.
 * Ignora filas que no son categorías reales (recaudación, totales, etc.)
 */

function parseTablaPremiosHTML(html, juego) {
    const $ = cheerio.load(html);
    const premios = new Map();

    // Buscar tabla con cabecera "Categoría"
    const tabla = $("table")
        .filter((_, el) => {
            const headers = $(el)
                .find("th")
                .map((_, th) => $(th).text().toLowerCase())
                .get()
                .join(" ");
            return headers.includes("categor") && headers.includes("premio");
        })
        .first();

    if (!tabla.length) return premios;

    tabla.find("tbody tr").each((_, row) => {
        const celdas = $(row).find("td");
        if (!celdas.length) return;

        let categoriaRaw = $(celdas[0]).text().trim();
        let premioRaw = $(celdas[celdas.length - 1])
            .text()
            .trim();

        // Filtrar filas que no son categorías reales
        if (!categoriaRaw || categoriaRaw.toLowerCase().includes("recaud"))
            return;
        if (!premioRaw || premioRaw.includes("€") === false) return;

        // Extraer solo "1ª" de "1ª (5 + 2)"
        let categoria = categoriaRaw.split(" ")[0].trim();

        // Si es reintegro (solo para primitiva)
        if (
            juego === "primitiva" &&
            categoriaRaw.toLowerCase().includes("reintegro")
        ) {
            categoria = "6ª";
        }

        // Asegurar formato correcto
        categoria = categoria.replace("º", "ª");
        if (/^\d+$/.test(categoria)) categoria = categoria + "ª";

        // Convertir importe a número
        const premioNum = parseFloat(
            premioRaw.replace(/[€.]/g, "").replace(",", ".")
        );

        premios.set(categoria, {
            txt: premioRaw,
            num: isNaN(premioNum) ? null : premioNum,
        });
    });

    return premios;
}

// 🆕 Scrapers por juego

// PRIMITIVA
async function scrapePremiosPrimitiva(fechaISO) {
    const url = urlPremiosPrimitiva(fechaISO); // ya la tienes creada
    const { data: html } = await axios.get(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
    });
    const $ = cheerio.load(html);
    const res = [];

    const tabla = $("table")
        .filter((_, el) => {
            const heads = $(el)
                .find("th")
                .map((__, th) => $(th).text().toLowerCase())
                .get()
                .join(" ");
            return heads.includes("categor") && heads.includes("premio");
        })
        .first();

    if (!tabla.length) return res;

    tabla.find("tbody tr").each((_, tr) => {
        const tds = $(tr).find("td");
        if (!tds.length) return;
        const catRaw = $(tds[0]).text().trim(); // "1ª (6)" / "2ª (5 + C)" / "6ª (R)"
        const premRaw = $(tds[tds.length - 1])
            .text()
            .trim(); // "8,00 €" etc
        const low = catRaw.toLowerCase();
        if (
            !catRaw ||
            low.includes("recaud") ||
            low.includes("destinado") ||
            low.includes("total")
        )
            return;

        // Normaliza a FORMATO B (dejamos tal cual + pulimos espacios)
        const categoria = catRaw.replace(/\s+/g, " ").replace("º", "ª").trim();
        const premioNum = parseFloat(
            premRaw.replace(/[€.]/g, "").replace(",", ".")
        );
        res.push({
            categoria,
            aciertos: (catRaw.match(/\(([^)]+)\)/)?.[1] || "").replace(
                /\s+/g,
                ""
            ),
            premio_num: isNaN(premioNum) ? 0 : premioNum,
            premio_txt: premRaw,
        });
    });

    return res;
}

// GORDO
async function scrapePremiosGordo(fechaISO) {
    const url = urlPremiosGordo(fechaISO); // ya la tienes creada
    const { data: html } = await axios.get(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
    });
    const $ = cheerio.load(html);
    const res = [];

    const tabla = $("table")
        .filter((_, el) => {
            const heads = $(el)
                .find("th")
                .map((__, th) => $(th).text().toLowerCase())
                .get()
                .join(" ");
            return heads.includes("categor") && heads.includes("premio");
        })
        .first();

    if (!tabla.length) return res;

    tabla.find("tbody tr").each((_, tr) => {
        const tds = $(tr).find("td");
        if (!tds.length) return;
        const catRaw = $(tds[0]).text().trim(); // "1ª (5 + Clave)" / "5ª (3 + Clave)"
        const premRaw = $(tds[tds.length - 1])
            .text()
            .trim();
        const low = catRaw.toLowerCase();
        if (
            !catRaw ||
            low.includes("recaud") ||
            low.includes("destinado") ||
            low.includes("total")
        )
            return;

        const categoria = catRaw.replace(/\s+/g, " ").replace("º", "ª").trim();
        const premioNum = parseFloat(
            premRaw.replace(/[€.]/g, "").replace(",", ".")
        );
        res.push({
            categoria,
            aciertos: (catRaw.match(/\(([^)]+)\)/)?.[1] || "").replace(
                /\s+/g,
                ""
            ),
            premio_num: isNaN(premioNum) ? 0 : premioNum,
            premio_txt: premRaw,
        });
    });

    return res;
}

async function scrapePremiosEuromillones_viaAjax(fechaISO) {
    // 1) resolver HASH por fecha
    const hash = await resolverHashEuromillones(fechaISO);
    if (!hash) return [];
    // 2) traer HTML de premios por POST
    const html = await fetchPremiosHtmlEuromillones(hash);
    if (!html) return [];
    // 3) parsear tabla a items
    return parsePremiosEuromillones(html);
}

//// 5) Acceso a BD (leer/insertar premios por sorteo)
// 🆕 Crea tabla si no existe
async function ensureTablaPremios(conn) {
    await conn.query(`
    CREATE TABLE IF NOT EXISTS premios_sorteos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tipoApuesta VARCHAR(20) NOT NULL,
      sorteo VARCHAR(30) NOT NULL,
      fecha DATE NOT NULL,
      categoria VARCHAR(64) NOT NULL,
      aciertos VARCHAR(30) NOT NULL,
      premio DECIMAL(12,2) NOT NULL,
      premio_text VARCHAR(32) NOT NULL,
      UNIQUE KEY u1 (tipoApuesta, sorteo, categoria)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

// 🆕 Lee de BD todos los premios de un sorteo → Map("1ª" => {num,txt})
async function leerPremiosDeDB(conn, tipo, sorteo) {
    const rows = await conn.query(
        `SELECT categoria, premio, premio_text FROM premios_sorteos WHERE tipoApuesta=? AND sorteo=?`,
        [tipo, sorteo]
    );
    const map = new Map();
    const keyFromCategoria = (cat) => {
        const s = (cat || "").toString().trim();
        const m = s.match(/^(\d+)[ªº]/);
        if (m) return `${m[1]}ª`;
        if (/^reintegro/i.test(s)) return "Reintegro";
        return s;
    };
    rows.forEach((r) => {
        const key = keyFromCategoria(r.categoria);
        map.set(key, { num: Number(r.premio), txt: r.premio_text });
    });
    return map;
}

// 🆕 Inserta premios en BD
async function insertarPremiosEnDB(conn, tipo, sorteo, fechaISO, items) {
    for (const it of items) {
        await conn.query(
            `INSERT INTO premios_sorteos (tipoApuesta, sorteo, fecha, categoria, aciertos, premio, premio_text)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE premio=VALUES(premio), premio_text=VALUES(premio_text)`,
            [
                tipo,
                sorteo,
                fechaISO_Local(parseISODateLocal(fechaISO)),
                it.categoria,
                it.aciertos || "",
                it.premio_num,
                it.premio_txt || "",
            ]
        );
    }
}

// Extrae un número de sorteo "limpio" (81, 121, 44) desde cualquier formato
function sorteoNumeroLimpio(valor) {
    if (!valor) return "";

    // Si viene numérico, lo convertimos a string y devolvemos
    if (typeof valor === "number") return valor.toString();

    const s = valor.toString().trim();

    // Caso PRIMITIVA → "2025/081"  → queremos "081"
    if (s.includes("/")) {
        const partes = s.split("/");
        const num = partes[1]?.trim();
        return num && /^\d+$/.test(num) ? num : s;
    }

    // Caso general → extraer solo la primera secuencia numérica
    const m = s.match(/\d+/);
    return m ? m[0] : s;
}

//// 6) Obtener premios (caché + DB + scrape)

// 🆕 Cache en memoria por ejecución
const premiosCache = new Map(); // clave: `${tipo}|${sorteo}` -> Map("1ª" => {num,txt})

export async function getPremios(tipo, s, conn) {
    const sorteoKey = sorteoNumeroLimpio(s.sorteo); // 👈 clave numérica
    const key = `${tipo}|${sorteoKey}`;

    if (premiosCache.has(key)) return premiosCache.get(key);
    await ensureTablaPremios(conn);

    let map = await leerPremiosDeDB(conn, tipo, sorteoKey);
    if (map && map.size > 0) {
        premiosCache.set(key, map);
        return map;
    }

    let items = [];
    if (tipo === "primitiva") items = await scrapePremiosPrimitiva(s.fecha);
    else if (tipo === "gordo") items = await scrapePremiosGordo(s.fecha);
    else if (tipo === "euromillones")
        items = await scrapePremiosEuromillones_viaAjax(s.fecha);

    if (items.length > 0) {
        await insertarPremiosEnDB(conn, tipo, sorteoKey, s.fecha, items);
        map = await leerPremiosDeDB(conn, tipo, sorteoKey);
    } else {
        map = new Map();
    }
    premiosCache.set(key, map);
    return map;
}
