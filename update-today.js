#!/usr/bin/env node
/**
 * update-today.js
 * Actualiza resultados y premios SOLO de los sorteos del día actual.
 * - Euromillones: martes y viernes (hoy)
 * - Primitiva: lunes, jueves y sábado (hoy)
 * - Gordo: domingo domingo(hoy))
 *
 * Requiere funciones scraper (ver notas más abajo):
 *   - euromillones.js: scrapeResultadosEuromillonesByFecha, scrapePremiosEuromillonesByFecha
 *   - primitiva.js  : scrapeResultadosPrimitivaByFecha,   scrapePremiosPrimitivaByFecha
 *   - gordo.js      : scrapeResultadosGordoByFecha,       scrapePremiosGordoByFecha
 *
 *
 * Uso:
 *   node update-today.js [--all|--both|--cre|--family] [--text=YYYY-MM-DD]
 *     --all o --both : actualiza todas las variantes (.env_cre y .env_family)
 *     --cre          : actualiza solo la variante 'cre' (.env_cre)
 *     --family       : actualiza solo la variante 'family' (.env_family)
 *     --text         : usar una fecha concreta (formato YYYY-MM-DD) en lugar del día actual
 *     Si no se especifica nada, se mostrara esta ayuda
 *  
*/

import dotenv from "dotenv";
import mariadb from "mariadb";
import path from "path";
import fs from "fs";
import { fechaISO, weekday } from "./src/helpers/fechas.js";
import { sorteoNumeroNNN } from "./src/helpers/funciones.js";
import {
    cmpEuromillones,
    cmpPrimitiva,
    cmpGordo,
    buscarPremioEurom,
    buscarPremioPrimitiva,
    buscarPremioGordo,
} from "./src/helpers/premios.js";

// 🔗 scrapers (los añadimos en la entrega 4/6)
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

const ROOT = path.resolve();
const LOG_FILE = path.join(ROOT, "logs", "Update-today.log");
try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
} catch {}
const origLog = console.log.bind(console);
const origErr = console.error.bind(console);
function appendLog(level, args) {
    const message = args
        .map((arg) =>
            typeof arg === "string"
                ? arg
                : (() => {
                      try {
                          return JSON.stringify(arg);
                      } catch {
                          return String(arg);
                      }
                  })()
        )
        .join(" ");
    const fechaHora = new Date();
    const line = `[${fechaHora.toLocaleDateString()} ${fechaHora.toLocaleTimeString()}] [${level}] ${message}\n`;
    try {
        fs.appendFileSync(LOG_FILE, line);
    } catch {}
}
console.log = (...args) => {
    origLog(...args);
    appendLog("INFO", args);
};
console.error = (...args) => {
    origErr(...args);
    appendLog("ERROR", args);
};

const ENV_BASE = path.join(ROOT, ".env");
function readEnvFile(filePath) {
    try {
        const raw = fs.readFileSync(filePath);
        return dotenv.parse(raw);
    } catch {
        return {};
    }
}
function buildEnvForVariant(variant) {
    const base =''; // readEnvFile(ENV_BASE);
    const variantFile =
        variant && variant !== "default"
            ? path.join(ROOT, `.env_${variant}`)
            : process.env.ENV_FILE
            ? path.join(ROOT, process.env.ENV_FILE)
            : process.env.APP_VARIANT
            ? path.join(ROOT, `.env_${process.env.APP_VARIANT}`)
            : null;
    const variantEnv = variantFile ? readEnvFile(variantFile) : {};
    return {
        ...base,
        ...process.env,
        ...variantEnv,
        APP_VARIANT: variant || process.env.APP_VARIANT || "default",
    };
}

// =============== utils (unificados en helpers/fechas) ===============

async function existeResultado(conn, tabla, fechaISO) {
    const r = await conn.query(
        `SELECT COUNT(*) AS n FROM ${tabla} WHERE fecha = ?`,
        [fechaISO]
    );
    return (r[0]?.n || 0) > 0;
}

async function existePremios(conn, tipoApuesta, fechaISO) {
    // Desde r_xxx obtenemos sorteo y luego miramos premios.
    let tabla;
    if (tipoApuesta === "euromillones") tabla = "r_euromillones";
    else if (tipoApuesta === "primitiva") tabla = "r_primitiva";
    else if (tipoApuesta === "gordo") tabla = "r_gordo";
    else return false;

    const rows = await conn.query(
        `SELECT sorteo FROM ${tabla} WHERE fecha = ? LIMIT 1`,
        [fechaISO]
    );
    if (!rows.length) return false;

    const sorteo = rows[0].sorteo?.toString() || "";
    // premios_sorteos.sorteo está normalizado a NNN para eurom/gordo y a NNN (parte derecha) para primitiva
    const nnn = (sorteo.includes("/") ? sorteo.split("/")[1] : sorteo).padStart(
        3,
        "0"
    );

    const p = await conn.query(
        `SELECT COUNT(*) AS n FROM premios_sorteos WHERE tipoApuesta = ? AND sorteo = ? AND fecha = ?`,
        [tipoApuesta, nnn, fechaISO]
    );
    return (p[0]?.n || 0) > 0;
}

// =============== premios ===============
const TABLA_RESULTADOS = {
    euromillones: "r_euromillones",
    primitiva: "r_primitiva",
    gordo: "r_gordo",
};
const TABLA_BOLETOS = {
    euromillones: "euromillones",
    primitiva: "primitiva",
    gordo: "gordo",
};

function formatEuro(num) {
    const n = Number(num);
    if (!Number.isFinite(n)) return `${num}`;
    return (
        n.toLocaleString("es-ES", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }) + " €"
    );
}

function esPremioValido(premio) {
    return premio && !premio.pendiente;
}
function esPremioConImporte(premio) {
    return (
        esPremioValido(premio) &&
        typeof premio.premio === "number" &&
        premio.premio > 0
    );
}
async function sorteoTieneCategorias(conn, tipo, sorteoNNN) {
    const r = await conn.query(
        `SELECT COUNT(*) AS n FROM premios_sorteos WHERE tipoApuesta=? AND (sorteo=? OR sorteo LIKE ?)`,
        [tipo, sorteoNNN, `%/${sorteoNNN}`]
    );
    return (r[0]?.n || 0) > 0;
}

async function calcularPremiosPlan(conn, tipo, fechaISO) {
    const tablaRes = TABLA_RESULTADOS[tipo];
    const tablaBols = TABLA_BOLETOS[tipo];
    if (!tablaRes || !tablaBols) return { totalImporte: 0, premiados: 0 };

    const resultados = await conn.query(
        `SELECT * FROM ${tablaRes} WHERE fecha = ?`,
        [fechaISO]
    );
    if (!resultados.length) return { totalImporte: 0, premiados: 0 };

    let totalImporte = 0;
    let premiados = 0;

    for (const res of resultados) {
        const sorteoNNN = sorteoNumeroNNN(res.sorteo);
        if (!sorteoNNN) continue;

        const boletos = await conn.query(
            `SELECT * FROM sorteos WHERE tipoApuesta=? AND sorteo=?`,
            [tipo, Number(sorteoNNN)]
        );
        if (!boletos.length) continue;

        for (const b of boletos) {
            const [boleto] = await conn.query(
                `SELECT * FROM ${tablaBols} WHERE identificador=?`,
                [b.identificadorBoleto]
            );
            if (!boleto) continue;

            let premio = null;
            if (tipo === "euromillones") {
                const cmp = cmpEuromillones(boleto, res);
                premio = await buscarPremioEurom(conn, sorteoNNN, cmp);
            } else if (tipo === "primitiva") {
                const cmp = cmpPrimitiva(boleto, res);
                premio = await buscarPremioPrimitiva(conn, sorteoNNN, cmp, {
                    sorteoTieneCategorias: () =>
                        sorteoTieneCategorias(conn, "primitiva", sorteoNNN),
                });
            } else if (tipo === "gordo") {
                const cmp = cmpGordo(boleto, res);
                premio = await buscarPremioGordo(conn, sorteoNNN, cmp);
            }

            if (esPremioValido(premio)) {
                premiados += 1;
                if (esPremioConImporte(premio)) {
                    totalImporte += premio.premio;
                }
            }
        }
    }

    return { totalImporte, premiados };
}

// =============== main ===============
async function runUpdateForVariant(variant) {
    const env = buildEnvForVariant(variant);
    Object.assign(process.env, env); // asegura que scrapers compartan el mismo env
    const pool = mariadb.createPool({
        host: env.DB_HOST,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        database: env.DB_DATABASE,
        connectionLimit: 5,
    });
    const conn = await pool.getConnection();
    const label = variant || "default";
    try {
        const hoy = env.UPDATE_DATE || fechaISO(new Date());
        const dow = weekday(hoy); // 0..6
        console.log(
            `Arrancamos Update-today [${label}] => ${hoy} día de la semana:(0 y 7 domingo) (dow=${dow})`
        );

        // Determinar qué juegos tocan hoy (y el lunes incluir el gordo de ayer)
        const planes = [];
        const premiosAnalizados = [];

        // Euromillones: martes(2) y viernes(5)
        if (dow === 2 || dow === 5) {
            planes.push({ tipo: "euromillones", fecha: hoy });
        }

        // Primitiva: lunes(1), jueves(4), sábado(6)
        if (dow === 1 || dow === 4 || dow === 6) {
            planes.push({ tipo: "primitiva", fecha: hoy });
        }

        // Gordo: domingo(0)
        if (dow === 0) {
            planes.push({ tipo: "gordo", fecha: hoy });
        }

        if (!planes.length) {
            console.log(
                "ℹ️ No hay sorteos que actualizar hoy según el calendario."
            );
            return;
        }

        for (const plan of planes) {
            const { tipo, fecha } = plan;

            let tablaResultados = "";
            if (tipo === "euromillones") tablaResultados = "r_euromillones";
            if (tipo === "primitiva") tablaResultados = "r_primitiva";
            if (tipo === "gordo") tablaResultados = "r_gordo";

            console.log(
                `\n🔎 [${label}] ${tipo.toUpperCase()} -> fecha ${fecha}`
            );

            // Verificación de hora mínima de publicación (22:00 del día analizado)
            const ahora = new Date();
            const limitePublicacion = new Date(`${fecha}T22:00:00`);
            if (ahora < limitePublicacion) {
                console.log(
                    `   todavia no se han publicado los resultados de ${tipo}`
                );
                continue; // saltar a siguiente plan sin intentar scrapeo
            }

            // 1) Resultados
            const tieneRes = await existeResultado(
                conn,
                tablaResultados,
                fecha
            );
            if (tieneRes) {
                console.log("   ✔️ Resultados ya existentes en BD.");
            } else {
                console.log("   ⤵️ Descargando resultados del día...");
                if (tipo === "euromillones") {
                    await scrapeResultadosEuromillonesByFecha(fecha);
                } else if (tipo === "primitiva") {
                    await scrapeResultadosPrimitivaByFecha(fecha);
                } else if (tipo === "gordo") {
                    await getResultadoGordo(fecha);
                }
                const ok = await existeResultado(conn, tablaResultados, fecha);
                console.log(
                    ok
                        ? "   ✅ Resultados guardados."
                        : "   ❌ No se guardaron resultados."
                );
            }

            // 2) Premios (solo si ya hay resultado)
            const tieneResAhora = await existeResultado(
                conn,
                tablaResultados,
                fecha
            );
            if (tieneResAhora) {
                const tienePrem = await existePremios(conn, tipo, fecha);
                if (tienePrem) {
                    console.log("   ✔️ Premios ya existentes en BD.");
                } else {
                    console.log("   ⤵️ Descargando tabla de premios...");
                    if (tipo === "euromillones") {
                        await scrapePremiosEuromillonesByFecha(fecha);
                    } else if (tipo === "primitiva") {
                        await scrapePremiosPrimitivaByFecha(fecha);
                    } else if (tipo === "gordo") {
                        await scrapePremiosGordoByFecha(fecha);
                    }
                    const okPrem = await existePremios(conn, tipo, fecha);
                    console.log(
                        okPrem
                            ? "   ✅ Premios guardados."
                            : "   ❌ No se guardaron premios (quizá aún no publicados)."
                    );
                }
            } else {
                console.log(
                    "   ⚠️ Saltando premios: no hay resultados en BD para esta fecha."
                );
            }

            // Calcular premios para este plan (solo análisis, sin efectos secundarios)
            try {
                const resumenPremios = await calcularPremiosPlan(
                    conn,
                    tipo,
                    fecha
                );
                premiosAnalizados.push({
                    tipo,
                    fecha,
                    ...resumenPremios,
                });
                console.log(
                    `   💶 Premios detectados para ${tipo} (${fecha}): ${formatEuro(
                        resumenPremios.totalImporte
                    )} [${resumenPremios.premiados} boleto(s) con premio]`
                );
            } catch (e) {
                console.warn(
                    `   ⚠️ No se pudieron calcular premios de ${tipo} (${fecha}):`,
                    e.message
                );
            }
        }

        const totalPremios = premiosAnalizados.reduce(
            (acc, p) => acc + (p.totalImporte || 0),
            0
        );
        console.log(
            `\n💰 Total premios analizados en esta ejecución: ${formatEuro(
                totalPremios
            )}`
        );

        console.log("\n✅ Actualización diaria finalizada.");
    } finally {
        try {
            conn.release();
            await pool.end();
        } catch {}
    }
}

(async () => {
    const printHelp = () => {
        console.log(
            [
                "Uso:",
                "  node update-today.js [--all|--both|--cre|--family] [--text=YYYY-MM-DD]",
                "",
                "Opciones:",
                "  --all | --both  actualizar variantes cre y family",
                "  --cre           actualizar solo la variante cre",
                "  --family        actualizar solo la variante family",
                "  --text=FECHA    usar una fecha concreta (YYYY-MM-DD)",
                "  --help          mostrar esta ayuda",
            ].join("\n")
        );
    };
    const rawArgs = process.argv.slice(2).filter(Boolean);
    if (!rawArgs.length || rawArgs.includes("--help")) {
        printHelp();
        process.exit(0);
    }
    const flagAll = rawArgs.some((a) => a === "--all" || a === "--both");
    const flagCre = rawArgs.includes("--cre");
    const flagFamily = rawArgs.includes("--family");
    const textArg = rawArgs
        .filter((a) => a.startsWith("--text="))
        .map((a) => a.split("=")[1])
        .filter(Boolean)[0];
    const variantsArg = rawArgs
        .filter((a) => a.startsWith("--variant="))
        .map((a) => a.split("=")[1])
        .filter(Boolean);
    const bareVariants = rawArgs
        .filter((a) => !a.startsWith("--"))
        .map((a) => a.trim())
        .filter(Boolean);

    if (textArg) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(textArg)) {
            console.log(
                "❌ Formato de fecha invalido para --text. Usa YYYY-MM-DD."
            );
            process.exit(1);
        }
        process.env.UPDATE_DATE = textArg;
    }

    let variants = [];
    if (flagAll) variants = ["cre", "family"];
    else if (variantsArg.length) variants = variantsArg;
    else if (flagCre || flagFamily)
        variants = [
            ...(flagCre ? ["cre"] : []),
            ...(flagFamily ? ["family"] : []),
        ];
    else if (bareVariants.length) variants = bareVariants;
    variants = [...new Set(variants.map((v) => v.toLowerCase()))];
    if (!variants.length) {
        console.log(
            "❌ No se pudo determinar variante. Usa --cre, --family o --all."
        );
        printHelp();
        process.exit(1);
    }

    for (const variant of variants) {
        try {
            console.log(
                `\n================= update-today (${
                    variant || "default"
                }) =================`
            );
            await runUpdateForVariant(variant);
        } catch (err) {
            console.error(
                `? Error en update-today (${variant || "default"}):`,
                err.stack || err.message
            );
        }
    }
})();
