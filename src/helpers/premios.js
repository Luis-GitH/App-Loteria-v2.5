import { dividirCadena, parseNumberOrNull, formatEuroText } from "./funciones.js";

export function cmpEuromillones(boleto, resultado) {
    const numerosB = dividirCadena(boleto.combinacion);
    const estB = dividirCadena(boleto.estrellas);
    const numerosS = (resultado.numeros || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    const estS = (resultado.estrellas || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    const aciertosNumeros = numerosB.filter((n) => numerosS.includes(n)).length;
    const aciertosEstrellas = estB.filter((e) => estS.includes(e)).length;
    return { aciertosNumeros, aciertosEstrellas };
}

export function cmpPrimitiva(boleto, resultado) {
    const numerosB = dividirCadena(boleto.combinacion);
    const numerosS = (resultado.numeros || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    const aciertosNumeros = numerosB.filter((n) => numerosS.includes(n)).length;
    const aciertoComplementario = numerosB.includes(
        (resultado.complementario || "").trim()
    )
        ? 1
        : 0;
    const aciertoReintegro =
        (boleto.reintegro || "").toString().trim() ===
        (resultado.reintegro || "").toString().trim()
            ? 1
            : 0;
    return { aciertosNumeros, aciertoComplementario, aciertoReintegro };
}

export function cmpGordo(boleto, resultado) {
    const toNumStr = (v) => {
        const n = parseInt((v ?? "").toString().trim(), 10);
        return Number.isFinite(n) ? String(n) : "";
    };
    const numerosB = dividirCadena(boleto.combinacion)
        .map(toNumStr)
        .filter(Boolean);
    const numerosS = (resultado.numeros || "")
        .split(",")
        .map((x) => toNumStr(x))
        .filter(Boolean);
    const setS = new Set(numerosS);
    const aciertosNumeros = numerosB.filter((n) => setS.has(n)).length;
    const claveBoleto = toNumStr(boleto.clave ?? boleto.numeroClave);
    const claveSorteo = toNumStr(resultado.numeroClave ?? resultado.clave);
    const aciertoClave =
        claveBoleto && claveSorteo && claveBoleto === claveSorteo ? 1 : 0;
    return { aciertosNumeros, aciertoClave };
}

const EUROMILLONES_CATEGORIAS = new Set([
    "5+2",
    "5+1",
    "5+0",
    "4+2",
    "4+1",
    "4+0",
    "3+2",
    "3+1",
    "3+0",
    "2+2",
    "2+1",
    "2+0",
    "1+2",
    "1+1",
    "0+2",
]);

export async function buscarPremioEurom(conn, sorteoNNN, cmp) {
    if (cmp.aciertosNumeros === 0 && cmp.aciertosEstrellas === 0) return null;
    const aciertos = `${cmp.aciertosNumeros}+${cmp.aciertosEstrellas}`;
    if (!EUROMILLONES_CATEGORIAS.has(aciertos)) return null;
    const rows = await conn.query(
        `SELECT categoria, premio, premio_text FROM premios_sorteos WHERE tipoApuesta='euromillones' AND sorteo=? AND aciertos=? LIMIT 1`,
        [sorteoNNN, aciertos]
    );
    if (!rows.length)
        return {
            aciertos,
            categoria: null,
            premio: null,
            premio_text: null,
            pendiente: true,
        };
    const r = rows[0];
    return {
        aciertos,
        categoria: r.categoria,
        premio: parseNumberOrNull(r.premio),
        premio_text: r.premio_text,
        pendiente: false,
    };
}

export async function buscarPremioPrimitiva(
    conn,
    sorteoNNN,
    cmp,
    { sorteoTieneCategorias } = {}
) {
    let aciertos = "";
    if (cmp.aciertosNumeros === 6 && cmp.aciertoReintegro === 1)
        aciertos = "6+R";
    else if (cmp.aciertosNumeros === 6) aciertos = "6";
    else if (cmp.aciertosNumeros === 5 && cmp.aciertoComplementario === 1)
        aciertos = "5+C";
    else if (cmp.aciertosNumeros === 5) aciertos = "5";
    else if (cmp.aciertosNumeros === 4) aciertos = "4";
    else if (cmp.aciertosNumeros === 3) aciertos = "3";
    else if (cmp.aciertoReintegro === 1) aciertos = "R";
    else return null;

    let rows = await conn.query(
        `SELECT categoria, premio, premio_text FROM premios_sorteos WHERE tipoApuesta='primitiva' AND sorteo=? AND aciertos=? LIMIT 1`,
        [sorteoNNN, aciertos]
    );
    if (!rows.length && sorteoNNN) {
        // Compatibilidad con registros antiguos almacenados como "YYYY/NNN"
        rows = await conn.query(
            `SELECT categoria, premio, premio_text FROM premios_sorteos WHERE tipoApuesta='primitiva' AND sorteo LIKE ? AND aciertos=? ORDER BY fecha DESC LIMIT 1`,
            [`%/${sorteoNNN}`, aciertos]
        );
    }

    if (!rows.length) {
        if (typeof sorteoTieneCategorias === "function") {
            const tieneTabla = await sorteoTieneCategorias();
            if (!tieneTabla) {
                return {
                    aciertos,
                    categoria: null,
                    premio: null,
                    premio_text: null,
                    pendiente: true,
                };
            }
            return null;
        }
        return {
            aciertos,
            categoria: null,
            premio: null,
            premio_text: null,
            pendiente: true,
        };
    }

    const r = rows[0];
    return {
        aciertos,
        categoria: r.categoria,
        premio: parseNumberOrNull(r.premio),
        premio_text: r.premio_text,
        pendiente: false,
    };
}

export async function buscarPremioGordo(conn, sorteoNNN, cmp) {
    if (cmp.aciertosNumeros === 0 && cmp.aciertoClave === 0) return null;
    const aciertos =
        cmp.aciertoClave === 1 && cmp.aciertosNumeros < 2
            ? "R"
            : `${cmp.aciertosNumeros}${cmp.aciertoClave ? "+C" : ""}`;
    const rows = await conn.query(
        `SELECT categoria, premio, premio_text FROM premios_sorteos WHERE tipoApuesta='gordo' AND sorteo=? AND aciertos=? LIMIT 1`,
        [sorteoNNN, aciertos]
    );
    if (!rows.length)
        return {
            aciertos,
            categoria: null,
            premio: null,
            premio_text: null,
            pendiente: true,
        };
    const r = rows[0];
    let premio = parseNumberOrNull(r.premio);
    const premioCategoria = premio;
    const premioCategoriaText = r.premio_text;
    let premio_text = r.premio_text;
    let premioReintegro = null;
    let premioReintegroText = null;
    let incluyeReintegro = false;
    if (cmp.aciertoClave === 1 && aciertos !== "R") {
        const reintegroRows = await conn.query(
            `SELECT premio, premio_text FROM premios_sorteos WHERE tipoApuesta='gordo' AND sorteo=? AND aciertos='R' LIMIT 1`,
            [sorteoNNN]
        );
        if (reintegroRows.length) {
            const reintegro = parseNumberOrNull(reintegroRows[0].premio);
            if (Number.isFinite(premio) && Number.isFinite(reintegro)) {
                premio = premio + reintegro;
                premio_text = formatEuroText(premio) || premio_text;
                premioReintegro = reintegro;
                premioReintegroText =
                    reintegroRows[0].premio_text || formatEuroText(reintegro);
                incluyeReintegro = true;
            } else if (Number.isFinite(reintegro)) {
                premio = (Number.isFinite(premio) ? premio : 0) + reintegro;
                premio_text =
                    formatEuroText(premio) ||
                    premio_text ||
                    reintegroRows[0].premio_text ||
                    null;
                premioReintegro = reintegro;
                premioReintegroText =
                    reintegroRows[0].premio_text || formatEuroText(reintegro);
                incluyeReintegro = true;
            }
        }
    }
    return {
        aciertos,
        categoria: r.categoria,
        premio,
        premio_text,
        premio_categoria: premioCategoria,
        premio_categoria_text: premioCategoriaText,
        premio_reintegro: premioReintegro,
        premio_reintegro_text: premioReintegroText,
        incluyeReintegro,
        pendiente: false,
    };
}
