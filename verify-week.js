////// verify-week.js viene de la v.02- auto-update + pendientes + rango //////

import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import mariadb from "mariadb";
import nodemailer from "nodemailer";
dotenv.config({ path: ".env", override: false });
const specificEnvPath =
  process.env.ENV_FILE ||
  (process.env.APP_VARIANT ? `.env_${process.env.APP_VARIANT}` : null) ||
  (process.env.PM2_APP_NAME === "app-cre"
    ? ".env_cre"
    : process.env.PM2_APP_NAME === "app-family"
      ? ".env_family"
      : null);
if (specificEnvPath) {
  dotenv.config({ path: specificEnvPath, override: true });
}
import {
    fechaISO,
    addDays,
    weekday,
    mondayOf,
    enumerateMondaysInRange,
} from "./src/helpers/fechas.js";
import {
   // dividirCadena,
   // parseNumberOrNull,
   // formatEuroText,
    sorteoNumeroNNN,
} from "./src/helpers/funciones.js";
import {
    cmpEuromillones,
    cmpPrimitiva,
    cmpGordo,
    buscarPremioPrimitiva,
    buscarPremioEurom,
    buscarPremioGordo,
} from "./src/helpers/premios.js";

// Scrapers esperados en tu repo:
import {
    scrapeResultadosEuromillonesByFecha,
    scrapePremiosEuromillonesByFecha,
} from "./src/modules/scrapers/euromillones.js";
import {
    scrapeResultadosPrimitivaByFecha,
    scrapePremiosPrimitivaByFecha,
} from "./src/modules/scrapers/primitiva.js";
import {
    getResultadoGordo,
    scrapePremiosGordoByFecha,
} from "./src/modules/scrapers/gordo.js";

// ================== CONFIG ==================
const ROOT = path.resolve();
const VARIANT_ENV_MAP = {
    cre: ".env_cre",
    family: ".env_family",
};
const KNOWN_VARIANTS = Object.keys(VARIANT_ENV_MAP);
const DEFAULT_VARIANT =
    KNOWN_VARIANTS.includes("cre") && KNOWN_VARIANTS.length
        ? "cre"
        : KNOWN_VARIANTS[0] || "default";
function normalizeVariantName(name) {
    return (name || "").toString().trim().toLowerCase();
}
function pickVariant(candidate) {
    const normalized = normalizeVariantName(candidate);
    return KNOWN_VARIANTS.includes(normalized) ? normalized : null;
}
function resolvePm2Variant() {
    if (
        process.env.PM2_APP_NAME &&
        process.env.PM2_APP_NAME.startsWith("app-")
    ) {
        return process.env.PM2_APP_NAME.slice(4);
    }
    return process.env.PM2_APP_NAME;
}
const APP_VARIANT =
    pickVariant(process.env.APP_VARIANT) ||
    pickVariant(resolvePm2Variant()) ||
    DEFAULT_VARIANT;
const LOG_DIR = path.join(ROOT, "logs");
const ENV_BASE = path.join(ROOT, ".env");
const HISTORICO_DIR = path.join(ROOT, "data", `historico-${APP_VARIANT}`);
const HISTORICO_DIRS = Array.from(
    new Set([
        HISTORICO_DIR,
        ...KNOWN_VARIANTS.map((v) =>
            path.join(ROOT, "data", `historico-${v}`)
        ),
        path.join(ROOT, "data", "historico"),
    ])
);

function readEnvFile(filePath) {
    try {
        const raw = fs.readFileSync(filePath);
        return dotenv.parse(raw);
    } catch {
        return {};
    }
}
function buildEnvForVariant(variant) {
    const base = readEnvFile(ENV_BASE);
    const normalizedVariant =
        pickVariant(variant) ||
        pickVariant(process.env.APP_VARIANT) ||
        pickVariant(resolvePm2Variant()) ||
        APP_VARIANT ||
        DEFAULT_VARIANT;
    const variantFile =
        normalizedVariant && normalizedVariant !== "default"
            ? path.join(
                  ROOT,
                  VARIANT_ENV_MAP[normalizedVariant] ||
                      `.env_${normalizedVariant}`
              )
            : process.env.ENV_FILE
            ? path.join(ROOT, process.env.ENV_FILE)
            : null;
    const variantEnv = variantFile ? readEnvFile(variantFile) : {};
    return {
        ...base,
        ...process.env,
        ...variantEnv,
        APP_VARIANT: normalizedVariant || DEFAULT_VARIANT,
    };
}
function createPoolFromEnv(env) {
    return mariadb.createPool({
        host: env.DB_HOST,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        database: env.DB_DATABASE,
        dateStrings: true, // evitar desfases de zona horaria en columnas DATE
        connectionLimit: 5,
    });
}
function buildMailConfig(env) {
    const variantLabel = (
        env.APP_VARIANT ||
        env.PM2_APP_NAME ||
        "default"
    ).toString();
    const subjectPrefix = `[verify-week|${variantLabel}]`;
    return {
        from: env.EMAIL_FROM,
        to: env.EMAIL_TO,
        subject: `${subjectPrefix} Verificación semanal de resultados`,
        subjectRange: (ini, fin) =>
            `${subjectPrefix} Verificación de resultados (${ini} -> ${fin})`,
        smtp: {
            host: env.EMAIL_HOST,
            port: Number(env.EMAIL_PORT || 465),
            secure: true,
            auth: {
                user: env.EMAIL_USER,
                pass: env.EMAIL_PASSWORD,
            },
        },
    };
}
let pool = null;
let MAIL_CONFIG = null;
let MODO_DEV = false;
function initEnvForVariant(variant) {
    const env = buildEnvForVariant(variant);
    Object.assign(process.env, env);
    pool = createPoolFromEnv(env);
    MAIL_CONFIG = buildMailConfig(env);
    MODO_DEV = env.MODE_DEV || false;
    return env;
}

function fallbackVariant() {
    return (
        pickVariant(process.env.APP_VARIANT) ||
        pickVariant(resolvePm2Variant()) ||
        APP_VARIANT ||
        DEFAULT_VARIANT
    );
}
function ensurePool() {
    if (!pool) {
        initEnvForVariant(fallbackVariant());
    }
    return pool;
}

const PUBLISH_HINT = {
    euromillones: "normalmente tras la medianoche del día siguiente",
    primitiva: "normalmente tras la medianoche del día siguiente",
    gordo: "normalmente se publican el lunes por la mañana",
};

const WEEKDAY_ES = [
    "domingo",
    "lunes",
    "martes",
    "miércoles",
    "jueves",
    "viernes",
    "sábado",
];

// ================== FECHAS ==================
// Unificadas desde src/helpers/fechas.js

// ================== HELPERS ==================
function toFsImagePath(p) {
    if (!p) return null;
    const s = p.toString();
    if (/^https?:/i.test(s)) return null;
    // Web path expuesto tipo /historico-family/xxxx.jpg
    if (/^\/historico[^/]*\//i.test(s)) {
        const rel = s.replace(/^\//, "");
        const candidate = path.join(ROOT, "data", rel);
        if (fs.existsSync(candidate)) return candidate;
        return path.join(ROOT, rel);
    }
    if (s.startsWith("/historico/")) {
        const rel = s.replace(/^\/historico\//, "");
        for (const dir of HISTORICO_DIRS) {
            const candidate = path.join(dir, rel);
            if (fs.existsSync(candidate)) return candidate;
        }
        return path.join(HISTORICO_DIR, rel);
    }
    if (path.isAbsolute(s)) return s;
    // Fallback: usar basename en /data/historico-<variant> o legacy si existe
    const base = path.basename(s);
    for (const dir of HISTORICO_DIRS) {
        const candidate = path.join(dir, base);
        if (fs.existsSync(candidate)) return candidate;
    }
    return path.join(HISTORICO_DIR, base);
}
function fmtEu(num) {
    if (typeof num !== "number" || Number.isNaN(num))
        return "sin premio asignado";
    return (
        num.toLocaleString("es-ES", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }) + " \u20ac"
    );
}

function esPremioConImporte(premio) {
    return (
        premio &&
        !premio.pendiente &&
        typeof premio.premio === "number" &&
        premio.premio > 0
    );
}
function esPremio(premio) {
    return premio && !premio.pendiente;
}

function cabeceraEurom(s) {
    const nums = (s.numeros || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .join(" ");
    const est = (s.estrellas || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .join(" ");
    const elM = (s.elMillon || "").toString().trim();
    const sorteo = sorteoNumeroNNN(s.sorteo);
    const fecha = (s.fecha || "").toString().slice(0, 10);
    const extra = elM ? ` · El Millon: ${elM}` : "";
    return `Sorteo ${sorteo} (${fecha}): ${nums} + ${est}${extra}`;
}

function cabeceraPrimi(s) {
    const nums = (s.numeros || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .join(" ");
    const comp = (s.complementario || "").toString();
    const rein = (s.reintegro || "").toString();
    const sorteo = sorteoNumeroNNN(s.sorteo);
    const fecha = (s.fecha || "").toString().slice(0, 10);
    return `Sorteo ${sorteo} (${fecha}): ${nums} · C:${comp} · R:${rein}`;
}

function cabeceraGordo(s) {
    const nums = (s.numeros || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .join(" ");
    const clave = (s.numeroClave || s.clave || "").toString();
    const sorteo = sorteoNumeroNNN(s.sorteo);
    const fecha = (s.fecha || "").toString().slice(0, 10);
    return `Sorteo ${sorteo} (${fecha}): ${nums} · Clave:${clave}`;
}

// ================== DB HELPERS ==================
async function getRecipients(target) {
    ensurePool();
    const conn = await pool.getConnection();
    try {
        const t = process.env.MODO_DESARROLLO;

        let sql = `SELECT email FROM users WHERE email IS NOT NULL AND email <> ''`;
        if (t == 1) sql += ` AND tipo='admin'`;

        const rows = await conn.query(sql);
        const set = new Set();
        for (const r of rows) {
            const e = (r.email || "").toString().trim();
            if (!e) continue;
            set.add(e);
        }
        return Array.from(set.values());
    } finally {
        conn.release();
    }
}

async function existeResultadoPorFecha(conn, tabla, fechaISO) {
    // Normaliza fecha a "YYYY-MM-DD" sin convertir a Date (evita desfase horario)
    const fechaStr = (fechaISO || "").toString().slice(0, 10);
    const r = await conn.query(
        `SELECT COUNT(*) AS n FROM ${tabla} WHERE fecha = ?`,
        [fechaStr]
    );
    return (r[0]?.n || 0) > 0;
}
async function existePremiosPorFecha(conn, tipoApuesta, fechaISO) {
    const fechaStr = (fechaISO || "").toString().slice(0, 10);
    let tabla;
    if (tipoApuesta === "euromillones") tabla = "r_euromillones";
    else if (tipoApuesta === "primitiva") tabla = "r_primitiva";
    else if (tipoApuesta === "gordo") tabla = "r_gordo";
    else return false;

    const rows = await conn.query(
        `SELECT sorteo FROM ${tabla} WHERE fecha = ? LIMIT 1`,
        [fechaStr]
    );
    if (!rows.length) return false;

    const nnn = (rows[0].sorteo ?? "").toString().trim();

    const p = await conn.query(
        `SELECT COUNT(*) AS n FROM premios_sorteos WHERE tipoApuesta = ? AND sorteo = ? AND fecha = ?`,
        [tipoApuesta, nnn, fechaStr]
    );
    if ((p[0]?.n || 0) > 0) return true;
    // Fallback: si no hay fecha asociada en premios_sorteos, comprobar por sorteo únicamente (acepta registros antiguos "YYYY/NNN")
    const r = await conn.query(
        `SELECT COUNT(*) AS n FROM premios_sorteos WHERE tipoApuesta=? AND (sorteo=? OR sorteo LIKE ?)`,
        [tipoApuesta, nnn, `%/${nnn}`]
    );
    return (r[0]?.n || 0) > 0;
}
async function sorteoTieneCategorias(conn, tipo, sorteoNNN) {
    const r = await conn.query(
        `SELECT COUNT(*) AS n FROM premios_sorteos WHERE tipoApuesta=? AND (sorteo=? OR sorteo LIKE ?)`,
        [tipo, sorteoNNN, `%/${sorteoNNN}`]
    );
    return (r[0]?.n || 0) > 0;
}

// ================== SAFE SCRAPE (marca pendientes) ==================
async function safeScrape({ label, tipo, fecha, fn, pendientes }) {
    try {
        console.log(`   🌐 ${label} ${fecha}`);
        const res = await fn();
        if (Array.isArray(res)) {
            if (res.length > 0)
                console.log(`      ✅ OK (${res.length} elemento(s))`);
            else console.log(`      ℹ️ Sin datos publicados aún`);
        } else if (typeof res === "boolean") {
            if (res) console.log(`      ✅ Guardado en BD`);
            else console.log(`      ℹ️ No disponible todavía (sin guardar)`);
        }
    } catch (err) {
        const status = err?.response?.status;
        const url = err?.response?.config?.url;
        if (
            status === 404 ||
            status === 403 ||
            status === 408 ||
            status === 500
        ) {
            pendientes.push({ tipo, fecha, label, status, url });
            console.warn(`   ⚠️ Pendiente: ${label} ${fecha} (HTTP ${status})`);
            return;
        }
        console.warn(
            `   ⚠️ Error no fatal en ${label} ${fecha}:`,
            status || err.message
        );
    }
}

// ================== AUTO-UPDATE (solo lo que falta) ==================
async function ensureDataForWeek(conn, fechaLunes, { verbose = true } = {}) {
    const fechas = {
        euromillones: [addDays(fechaLunes, 1), addDays(fechaLunes, 4)], // mar, vie
        primitiva: [fechaLunes, addDays(fechaLunes, 3), addDays(fechaLunes, 5)], // lun, jue, sáb
        gordo: [addDays(fechaLunes, 6)], // dom
    };

    const pendientes = [];

    if (verbose) {
        console.log(
            `🔍 Comprobando datos de la semana ${fechaLunes} → ${addDays(
                fechaLunes,
                6
            )}...`
        );
    }

    // EUROMILLONES
    for (const fecha of fechas.euromillones) {
        if (![2, 5].includes(weekday(fecha))) continue;

        const hasRes = await existeResultadoPorFecha(
            conn,
            "r_euromillones",
            fecha
        );
        if (!hasRes) {
            await safeScrape({
                label: "GET resultados Euromillones",
                tipo: "euromillones",
                fecha,
                fn: () => scrapeResultadosEuromillonesByFecha(fecha),
                pendientes,
            });
        }
        const hasRes2 = await existeResultadoPorFecha(
            conn,
            "r_euromillones",
            fecha
        );
        if (hasRes2) {
            const hasPrem = await existePremiosPorFecha(
                conn,
                "euromillones",
                fecha
            );
            if (!hasPrem) {
                await safeScrape({
                    label: "GET premios Euromillones",
                    tipo: "euromillones",
                    fecha,
                    fn: () => scrapePremiosEuromillonesByFecha(fecha),
                    pendientes,
                });
            }
        }
    }

    // PRIMITIVA
    for (const fecha of fechas.primitiva) {
        if (![1, 4, 6].includes(weekday(fecha))) continue;

        const hasRes = await existeResultadoPorFecha(
            conn,
            "r_primitiva",
            fecha
        );
        if (!hasRes) {
            await safeScrape({
                label: "GET resultados Primitiva",
                tipo: "primitiva",
                fecha,
                fn: () => scrapeResultadosPrimitivaByFecha(fecha),
                pendientes,
            });
        }
        const hasRes2 = await existeResultadoPorFecha(
            conn,
            "r_primitiva",
            fecha
        );
        if (hasRes2) {
            const hasPrem = await existePremiosPorFecha(
                conn,
                "primitiva",
                fecha
            );
            if (!hasPrem) {
                await safeScrape({
                    label: "GET premios Primitiva",
                    tipo: "primitiva",
                    fecha,
                    fn: () => scrapePremiosPrimitivaByFecha(fecha),
                    pendientes,
                });
            }
        }
    }

    // GORDO
    for (const fecha of fechas.gordo) {
        if (weekday(fecha) !== 0) continue;

        const hasRes = await existeResultadoPorFecha(conn, "r_gordo", fecha);
        if (!hasRes) {
            await safeScrape({
                label: "GET resultados Gordo",
                tipo: "gordo",
                fecha,
                fn: () => getResultadoGordo(fecha),
                pendientes,
            });
        }
        const hasRes2 = await existeResultadoPorFecha(conn, "r_gordo", fecha);
        if (hasRes2) {
            const hasPrem = await existePremiosPorFecha(conn, "gordo", fecha);
            if (!hasPrem) {
                await safeScrape({
                    label: "GET premios Gordo",
                    tipo: "gordo",
                    fecha,
                    fn: () => scrapePremiosGordoByFecha(fecha),
                    pendientes,
                });
            }
        }
    }

    if (verbose) console.log("✅ Datos de la semana actualizados si faltaban.");
    return pendientes;
}

// ================== COMPARADORES ==================
// Compartidos en src/helpers/premios.js

// ================== PROCESOS POR TIPO ==================
async function procesarEurom(conn, fechaLunes, fechaDomingo) {
    const resultados = await conn.query(
        `SELECT * FROM r_euromillones WHERE fecha BETWEEN ? AND ? ORDER BY fecha, sorteo`,
        [fechaLunes, fechaDomingo]
    );

    let resumen = "";
    const lineas = [];
    const adjuntos = [];
    const adjPaths = new Set();
    let premiados = 0;
    let totalImporte = 0;

    if (resultados.length) {
        resumen += `💰 Resultados de euromillones (${fechaLunes}):\n`;
        resumen += `📅 ${resultados.length} sorteos esta semana\n`;
        for (const s of resultados) resumen += cabeceraEurom(s) + "\n";
    }

    for (const s of resultados) {
        const sNNN = sorteoNumeroNNN(s.sorteo);
        const boletos = await conn.query(
            `SELECT * FROM sorteos WHERE tipoApuesta='euromillones' AND sorteo=?`,
            [Number(sNNN)]
        );
        if (!boletos.length) continue;

        for (const b of boletos) {
            const [boleto] = await conn.query(
                `SELECT * FROM euromillones WHERE identificador=?`,
                [b.identificadorBoleto]
            );
            if (!boleto) continue;

            const cmp = cmpEuromillones(boleto, s);
            const premio = await buscarPremioEurom(conn, sNNN, cmp);
            if (!premio) continue;

            const boletoId = b.identificadorBoleto.slice(-5);
            const header = `🎯 Boleto ${boletoId}`;
            let detalle = `${cmp.aciertosNumeros} números y ${cmp.aciertosEstrellas} estrellas`;
            if (premio.categoria) detalle += ` → Categoría ${premio.categoria}`;
            detalle += ` → ${fmtEu(premio.premio)}`;

            lineas.push({ boletoId, texto: header });
            lineas.push({ boletoId, texto: "   " + detalle });

            const premioValido = esPremio(premio);
            const tieneImporte = esPremioConImporte(premio);
            if (premioValido) {
                premiados += 1;
                if (tieneImporte) totalImporte += premio.premio;
            }

            const imgPath = (boleto.imagen || "").toString();
            const fsPath = toFsImagePath(imgPath);
            if (
                premioValido &&
                fsPath &&
                fs.existsSync(fsPath) &&
                !adjPaths.has(fsPath)
            ) {
                adjPaths.add(fsPath);
                adjuntos.push({
                    filename: path.basename(fsPath),
                    path: fsPath,
                });
            }
        }
    }

    if (!resultados.length) {
        resumen += `ℹ️ No hay sorteos en euromillones con fecha entre ${fechaLunes} y ${fechaDomingo}.`;
    } else if (!lineas.length) {
        resumen += `✔️ Sin aciertos en euromillones esta semana.\n`;
    } else {
        lineas.sort((a, b) => a.boletoId.localeCompare(b.boletoId));
        resumen += "\n" + lineas.map((x) => x.texto).join("\n") + "\n";
    }

    return { resumen, adjuntos, premiados, totalImporte };
}

async function procesarPrimitiva(conn, fechaLunes, fechaDomingo) {
    const resultados = await conn.query(
        `SELECT * FROM r_primitiva WHERE fecha BETWEEN ? AND ? ORDER BY fecha, sorteo`,
        [fechaLunes, fechaDomingo]
    );

    let resumen = "";
    const lineas = [];
    const adjuntos = [];
    const adjPaths = new Set();
    let premiados = 0;
    let totalImporte = 0;

    // Considerar como "publicado" solo si hay tabla de premios para esa fecha
    const publicados = [];
    for (const s of resultados) {
        const ok = await existePremiosPorFecha(conn, "primitiva", s.fecha);
        if (ok) publicados.push(s);
    }
    if (publicados.length) {
        resumen += `💰 Resultados de primitiva (${fechaLunes}):\n`;
        resumen += `📅 ${publicados.length} sorteo${
            publicados.length > 1 ? "s" : ""
        } esta semana\n`;
        for (const s of publicados) resumen += cabeceraPrimi(s) + "\n";
    }

    for (const s of publicados) {
        const sNNN = sorteoNumeroNNN(s.sorteo);
        const boletos = await conn.query(
            `SELECT * FROM sorteos WHERE tipoApuesta='primitiva' AND sorteo=?`,
            [Number(sNNN)]
        );
        if (!boletos.length) continue;

        for (const b of boletos) {
            const [boleto] = await conn.query(
                `SELECT * FROM primitiva WHERE identificador=?`,
                [b.identificadorBoleto]
            );
            if (!boleto) continue;

            const cmp = cmpPrimitiva(boleto, s);
            const premio = await buscarPremioPrimitiva(conn, sNNN, cmp, {
                sorteoTieneCategorias: () =>
                    sorteoTieneCategorias(conn, "primitiva", sNNN),
            });
            if (!premio) continue;

            const boletoId = b.identificadorBoleto.slice(-5);
            const header = `🎯 Boleto ${boletoId}`;

            let detalle = "";
            if (premio.aciertos === "R") detalle = `Reintegro acertado`;
            else if (premio.aciertos === "5+C")
                detalle = `5 números + complementario`;
            else if (premio.aciertos === "6+R")
                detalle = `6 números + reintegro`;
            else if (/^\d$/.test(premio.aciertos))
                detalle = `${premio.aciertos} números`;
            else detalle = `Aciertos ${premio.aciertos}`;
            if (premio.categoria) detalle += ` → Categoría ${premio.categoria}`;
            detalle += ` → ${fmtEu(premio.premio)}`;

            lineas.push({ boletoId, texto: header });
            lineas.push({ boletoId, texto: "   " + detalle });

            const premioValido = esPremio(premio);
            const tieneImporte = esPremioConImporte(premio);
            if (premioValido) {
                premiados += 1;
                if (tieneImporte) totalImporte += premio.premio;
            }

            const imgPath = (boleto.imagen || "").toString();
            const fsPath = toFsImagePath(imgPath);
            if (
                premioValido &&
                fsPath &&
                fs.existsSync(fsPath) &&
                !adjPaths.has(fsPath)
            ) {
                adjPaths.add(fsPath);
                adjuntos.push({
                    filename: path.basename(fsPath),
                    path: fsPath,
                });
            }
        }
    }

    if (!resultados.length) {
        resumen += `ℹ️ No hay sorteos en primitiva con fecha entre ${fechaLunes} y ${fechaDomingo}.`;
    } else if (!lineas.length) {
        resumen += `✔️ Sin aciertos en primitiva esta semana.\n`;
    } else {
        lineas.sort((a, b) => a.boletoId.localeCompare(b.boletoId));
        resumen += "\n" + lineas.map((x) => x.texto).join("\n") + "\n";
    }

    return { resumen, adjuntos, premiados, totalImporte };
}

async function procesarGordo(conn, fechaLunes, fechaDomingo) {
    const resultados = await conn.query(
        `SELECT * FROM r_gordo WHERE fecha BETWEEN ? AND ? ORDER BY fecha, sorteo`,
        [fechaLunes, fechaDomingo]
    );

    let resumen = "";
    const lineas = [];
    const adjuntos = [];
    const adjPaths = new Set();
    let premiados = 0;
    let totalImporte = 0;

    if (resultados.length) {
        resumen += `💰 Resultados de gordo (${fechaLunes}):\n`;
        resumen += `📅 ${resultados.length} sorteo${
            resultados.length > 1 ? "s" : ""
        } esta semana\n`;
        for (const s of resultados) resumen += cabeceraGordo(s) + "\n";
    }

    for (const s of resultados) {
        const sNNN = sorteoNumeroNNN(s.sorteo);
        const boletos = await conn.query(
            `SELECT * FROM sorteos WHERE tipoApuesta='gordo' AND sorteo=?`,
            [Number(sNNN)]
        );
        if (!boletos.length) continue;

        for (const b of boletos) {
            const [boleto] = await conn.query(
                `SELECT * FROM gordo WHERE identificador=?`,
                [b.identificadorBoleto]
            );
            if (!boleto) continue;

            const cmp = cmpGordo(boleto, s);
            const premio = await buscarPremioGordo(conn, sNNN, cmp);
            if (!premio) continue;

            const boletoId = b.identificadorBoleto.slice(-5);
            const header = `🎯 Boleto ${boletoId}`;

            let detalle = "";
            if (premio.aciertos.endsWith("+C"))
                detalle = `${premio.aciertos.replace(
                    "+C",
                    ""
                )} números + clave`;
            else if (/^\d$/.test(premio.aciertos))
                detalle = `${premio.aciertos} números`;
            else detalle = `Aciertos ${premio.aciertos}`;

            const catAmount =
                typeof premio.premio_categoria === "number"
                    ? fmtEu(premio.premio_categoria)
                    : fmtEu(premio.premio);
            if (premio.categoria)
                detalle += ` → Categoría ${premio.categoria} (${catAmount})`;
            else detalle += ` → ${catAmount}`;
            if (
                premio.incluyeReintegro &&
                typeof premio.reintegro === "number"
            ) {
                detalle += ` + Reintegro (${fmtEu(
                    premio.reintegro
                )}) → Total ${fmtEu(premio.premio)}`;
            } else {
                detalle += ` → ${fmtEu(premio.premio)}`;
            }

            lineas.push({ boletoId, texto: header });
            lineas.push({ boletoId, texto: "   " + detalle });

            const premioValido = esPremio(premio);
            const tieneImporte = esPremioConImporte(premio);
            if (premioValido) {
                premiados += 1;
                if (tieneImporte) totalImporte += premio.premio;
            }

            const imgPath = (boleto.imagen || "").toString();
            const fsPath = toFsImagePath(imgPath);
            if (
                premioValido &&
                fsPath &&
                fs.existsSync(fsPath) &&
                !adjPaths.has(fsPath)
            ) {
                adjPaths.add(fsPath);
                adjuntos.push({
                    filename: path.basename(fsPath),
                    path: fsPath,
                });
            }
        }
    }

    if (!resultados.length) {
        resumen += `ℹ️ No hay sorteos en gordo con fecha entre ${fechaLunes} y ${fechaDomingo}.`;
    } else if (!lineas.length) {
        resumen += `✔️ Sin aciertos en gordo esta semana.\n`;
    } else {
        lineas.sort((a, b) => a.boletoId.localeCompare(b.boletoId));
        resumen += "\n" + lineas.map((x) => x.texto).join("\n") + "\n";
    }

    return { resumen, adjuntos, premiados, totalImporte };
}

// ================== EMAIL ==================
async function enviarCorreoResumen({ subject, html, adjuntos = [], to }) {
    try {
        const transporter = nodemailer.createTransport(MAIL_CONFIG.smtp);
        const toList = Array.isArray(to) ? to : to ? [to] : [];
        await transporter.sendMail({
            from: MAIL_CONFIG.from,
            to: toList.length ? toList.join(",") : MAIL_CONFIG.to,
            subject,
            html,
            attachments: adjuntos,
        });
        console.log(
            "📧 Correo enviado a",
            toList.length ? toList.length : MAIL_CONFIG.to ? 1 : 0,
            "destinatario(s) con",
            adjuntos.length,
            "imagen(es)."
        );
    } catch (err) {
        console.error("❌ Error enviando correo:", err.message);
    }
}

// ================== PROCESO SEMANA ==================
export async function procesarSemana(fechaLunes, { autoUpdate = true } = {}) {
    ensurePool();
    const fechaDomingo = addDays(fechaLunes, 6);
    const conn = await pool.getConnection();

    // Log por semana
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const LOG_FILE = path.join(LOG_DIR, `verify_${fechaLunes}.log`);
    const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args) => {
        originalLog(...args);
        logStream.write(args.join(" ") + "\n");
    };
    console.error = (...args) => {
        originalError(...args);
        logStream.write("[ERROR] " + args.join(" ") + "\n");
    };

    let resumenFinal = "";
    let adjuntosFinal = [];
    let totalImporte = 0;

    try {
        console.log(`🔧 DEBUG: autoUpdate = ${autoUpdate}`);
        console.log(`🏁 Semana ${fechaLunes} → ${fechaDomingo}`);

        const pendientes = autoUpdate
            ? await ensureDataForWeek(conn, fechaLunes, { verbose: true })
            : [];

        const e = await procesarEurom(conn, fechaLunes, fechaDomingo);
        const p = await procesarPrimitiva(conn, fechaLunes, fechaDomingo);
        const g = await procesarGordo(conn, fechaLunes, fechaDomingo);

        const partes = [e.resumen.trim(), p.resumen.trim(), g.resumen.trim()];
        totalImporte = e.totalImporte + p.totalImporte + g.totalImporte;

        resumenFinal =
            `📆 Verificación de la semana (lunes: ${fechaLunes}):\n\n` +
            partes.filter(Boolean).join("\n\n") +
            `\n\n📊 Resumen de la semana:\n` +
            `- Euromillones: ${e.premiados} boleto${
                e.premiados !== 1 ? "s" : ""
            } premiado${e.premiados !== 1 ? "s" : ""} → ${fmtEu(
                e.totalImporte
            )}\n` +
            `- Primitiva: ${p.premiados} boleto${
                p.premiados !== 1 ? "s" : ""
            } premiado${p.premiados !== 1 ? "s" : ""} → ${fmtEu(
                p.totalImporte
            )}\n` +
            `- Gordo: ${g.premiados} boleto${
                g.premiados !== 1 ? "s" : ""
            } premiado${g.premiados !== 1 ? "s" : ""} → ${fmtEu(
                g.totalImporte
            )}\n\n` +
            `💵 TOTAL GANADO ESTA SEMANA: ${fmtEu(totalImporte)}\n`;

        // Bloque de pendientes (agrupado y con día de la semana)
        if (pendientes.length > 0) {
            const porTipo = pendientes.reduce((acc, p) => {
                (acc[p.tipo] ||= []).push(p.fecha);
                return acc;
            }, {});
            const lineasPend = Object.entries(porTipo)
                .map(([tipo, fechas]) => {
                    const hint =
                        PUBLISH_HINT[tipo] || "pendiente de publicación";
                    const lista = [...new Set(fechas)]
                        .sort()
                        .map((f) => `${WEEKDAY_ES[weekday(f)]} ${f}`)
                        .join(", ");
                    return `- ${tipo}: ${lista} → ${hint}`;
                })
                .join("\n");

            resumenFinal += `\n⚠️ Sorteos pendientes de publicación:\n${lineasPend}\n`;
        }

        // Adjuntos de-dup
        const seen = new Set();
        adjuntosFinal = [...e.adjuntos, ...p.adjuntos, ...g.adjuntos].filter(
            (a) => {
                if (seen.has(a.path)) return false;
                seen.add(a.path);
                return true;
            }
        );

        console.log(`📁 Log guardado en: ${LOG_FILE}`);
    } catch (err) {
        console.error("❌ Error verificando semana:", err.stack || err.message);
    } finally {
        conn.release();
        logStream.end();
        console.log = originalLog;
        console.error = originalError;
    }

    return { fechaLunes, resumenFinal, adjuntosFinal, totalImporte };
}

function parseVariantsArg(rawArgs) {
    const runAll = rawArgs.some((a) => a === "--all" || a === "--both");
    const flagFamily = rawArgs.includes("--family");
    const flagCre = rawArgs.includes("--cre");
    const cliVariants = rawArgs
        .filter((a) => a.startsWith("--variant="))
        .map((a) => normalizeVariantName(a.split("=")[1]))
        .filter(Boolean);
    const envListArg = rawArgs.find((a) => a.startsWith("--envs="));
    const envList = envListArg
        ? envListArg
              .split("=")[1]
              .split(",")
              .map(normalizeVariantName)
              .filter(Boolean)
        : [];

    let variants = [];
    if (runAll) variants = [...KNOWN_VARIANTS];
    else if (envList.length) variants = envList;
    else if (cliVariants.length) variants = cliVariants;
    else if (flagFamily || flagCre)
        variants = [
            ...(flagCre ? ["cre"] : []),
            ...(flagFamily ? ["family"] : []),
        ];
    else variants = [fallbackVariant()];

    variants = [...new Set(variants.map(normalizeVariantName).filter(Boolean))];
    const invalid = variants.filter((v) => !KNOWN_VARIANTS.includes(v));
    if (invalid.length) {
        throw new Error(
            `? Variantes no soportadas: ${invalid.join(
                ", "
            )}. Usa solo: ${KNOWN_VARIANTS.join(", ")}`
        );
    }

    return variants.length ? variants : [DEFAULT_VARIANT];
}

function parseCliArgs(rawArgs) {
    const argFecha = rawArgs.find((x) => x.startsWith("--fecha="));
    const argRango = rawArgs.find((x) => x.startsWith("--rango="));
    const autoWeek = rawArgs.includes("--week");
    const multiMail = rawArgs.includes("--multi-mail");
    const silent = rawArgs.includes("--silent");
    const noUpdate = rawArgs.includes("--no-update");

    const modes = [argFecha, argRango, autoWeek].filter(Boolean).length;
    if (modes > 1) {
        throw new Error(
            "? No combines --week con --fecha ni con --rango. Usa solo una modalidad."
        );
    }
    if (modes === 0) {
        throw new Error(
            "? Usa --fecha=YYYY-MM-DD (lunes) \n    o --rango=YYYY-MM-DD,YYYY-MM-DD \n    o --week (semana actual) \n    y --multi-mail \n      --silent \n      --no-update \n      --envs=cre,family"
        );
    }

    let semanas = [];
    if (autoWeek) {
        const hoy = fechaISO(new Date());
        const lunes = mondayOf(hoy);
        console.log(
            ` ℹ️ --week detectado: ejecutando la semana que inicia el lunes ${lunes} (hoy: ${hoy})`
        );
        semanas = [lunes];
    } else if (argRango) {
        const rangoPart = argRango.split("=")[1] || "";
        const [ini, fin] = rangoPart.split(",");
        if (!ini || !fin) {
            throw new Error(
                "? Formato de --rango invalido. Usa --rango=YYYY-MM-DD,YYYY-MM-DD"
            );
        }
        semanas = enumerateMondaysInRange(ini, fin);
    } else {
        const fl = argFecha.split("=")[1];
        semanas = [mondayOf(fl)];
    }

    return {
        semanas,
        multiMail,
        silent,
        noUpdate,
        variants: parseVariantsArg(rawArgs),
    };
}

// ================== MAIN (semana o rango) ==================
import { pathToFileURL } from "url";
const __isMain = (() => {
    try {
        return import.meta.url === pathToFileURL(process.argv[1] || "").href;
    } catch {
        return false;
    }
})();

if (__isMain)
    (async () => {
        let cli;
        try {
            cli = parseCliArgs(process.argv.slice(2));
        } catch (err) {
            console.error(err.message || err);
            process.exitCode = 1;
            return;
        }

        const runOnce = async ({ semanas, multiMail, silent, noUpdate }) => {
            const resultados = [];
            let adjuntosAcumulados = [];
            let totalAcumulado = 0;

            for (const sem of semanas) {
                const r = await procesarSemana(sem, { autoUpdate: !noUpdate });
                resultados.push(r);
                totalAcumulado += r.totalImporte;
                if (multiMail && !silent) {
                    let recipients = await getRecipients();
                    if (MODO_DEV && (!recipients || recipients.length === 0)) {
                        const devTo = (process.env.EMAIL_DEV_TO || '').trim();
                        recipients = devTo ? [devTo] : [MAIL_CONFIG.from];
                        console.log(
                            'MODO_DEV=true: enviando SOLO a',
                            recipients.join(',')
                        );
                    }
                    await enviarCorreoResumen({
                        subject: MAIL_CONFIG.subject,
                        html: `
          <h2>Comprobaci¢n de los resultados</h2>
          <p>A fecha: ${new Date().toLocaleString('es-ES')}</p>
          <pre style="font-family: monospace; white-space: pre-wrap;">${
              r.resumenFinal
          }</pre>
        `,
                        adjuntos: r.adjuntosFinal,
                        to: recipients,
                    });
                } else {
                    const seen = new Set(adjuntosAcumulados.map((a) => a.path));
                    for (const a of r.adjuntosFinal) {
                        if (!seen.has(a.path)) {
                            seen.add(a.path);
                            adjuntosAcumulados.push(a);
                        }
                    }
                }
            }

            if (!multiMail && !silent) {
                const ini = semanas[0];
                const fin = addDays(semanas[semanas.length - 1], 6);
                const cuerpo = resultados
                    .map((r) => r.resumenFinal)
                    .join("\n\n" + "?".repeat(35) + "\n\n");

                const html =
                    `<h2>Verificaci¢n de resultados (rango)</h2>` +
                    `<p>A fecha: ${new Date().toLocaleString('es-ES')}</p>` +
                    `<pre style="font-family: monospace; white-space: pre-wrap;">${cuerpo}

` +
                    `💰 TOTAL GANADO EN EL RANGO: ${fmtEu(totalAcumulado)}</pre>`;

                let recipients = await getRecipients();
                if (
                    process.env.MODO_DESARROLLO &&
                    (!recipients || recipients.length === 0)
                ) {
                    const devTo = (process.env.EMAIL_DEV_TO || '').trim();
                    recipients = devTo ? [devTo] : [MAIL_CONFIG.from];
                    console.log(
                        'MOD_DESARROLLO=true: enviando SOLO a',
                        recipients.join(',')
                    );
                }
                await enviarCorreoResumen({
                    subject: MAIL_CONFIG.subjectRange(ini, fin),
                    html,
                    adjuntos: adjuntosAcumulados,
                    to: recipients,
                });
            }
        };

        for (const variant of cli.variants) {
            try {
                console.log(`
================= verify-week (${variant}) =================`);
                if (pool && typeof pool.end === 'function') {
                    try {
                        await pool.end();
                    } catch {}
                    pool = null;
                }
                initEnvForVariant(variant);
                await runOnce(cli);
            } catch (err) {
                console.error(
                    `? Error en verify-week (${variant}):`,
                    err.stack || err.message
                );
            } finally {
                if (pool && typeof pool.end === 'function') {
                    try {
                        await pool.end();
                    } catch {}
                }
            }
        }
    })();
