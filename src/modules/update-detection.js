// src/modules/update-detection.js

import "dotenv/config"
import mariadb from "mariadb";
import { getWeek } from "date-fns";
import { parseISODateLocal } from "../helpers/fechas.js";

const pool = mariadb.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    connectionLimit: 5,
});

/**
 * Normaliza sorteo string → número (ej: "2025/128" → 128)
 */
function normalizeSorteo(valor) {
    if (!valor) return null;
    const m = valor.toString().match(/\d{1,3}$/);
    return m ? parseInt(m[0], 10) : null;
}

/**
 * Devuelve missingResults y missingPremios por tipo de apuesta
 */
export async function detectarDatosFaltantes(fechaLunes) {
    const conn = await pool.getConnection();
    const semana = getWeek(parseISODateLocal(fechaLunes));

    const tipos = [
        { tabla: "r_euromillones", nombre: "euromillones" },
        { tabla: "r_primitiva", nombre: "primitiva" },
        { tabla: "r_gordo", nombre: "gordo" },
    ];

    const resultado = {};

    try {
        for (const { tabla, nombre } of tipos) {
            // 1️⃣ Sorteos que existen en tablas r_ pero no tienen premios_sorteos
            const rows = await conn.query(
                `SELECT sorteo FROM ${tabla} WHERE semana = ? ORDER BY sorteo`,
                [semana]
            );
            const sorteosSemana = rows.map(r => normalizeSorteo(r.sorteo));

            const premiosRows = await conn.query(
                `SELECT DISTINCT sorteo FROM premios_sorteos WHERE tipoApuesta = ?`,
                [nombre]
            );
            const sorteosConPremios = premiosRows.map(r => normalizeSorteo(r.sorteo));

            const missingPremios = sorteosSemana.filter(
                s => !sorteosConPremios.includes(s)
            );

            // 2️⃣ Sorteos que NO están ni en r_
            //    (solo verificable con detectores según tipo, fill later)
            const missingResults = []; // detectado en otro paso

            resultado[nombre] = { missingResults, missingPremios };
        }

        return resultado;
    } finally {
        conn.release();
    }
}
