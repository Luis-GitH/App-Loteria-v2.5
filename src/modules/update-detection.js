// src/modules/update-detection.js

import "dotenv/config"
import mariadb from "mariadb";
import { addDays } from "../helpers/fechas.js";
import { sorteoNumeroNNN, sorteoKeyFromFecha } from "../helpers/funciones.js";

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
    if (!valor) return "";
    return sorteoNumeroNNN(valor);
}

/**
 * Devuelve missingResults y missingPremios por tipo de apuesta
 */
export async function detectarDatosFaltantes(fechaLunes) {
    const conn = await pool.getConnection();
    const fechaFin = addDays(fechaLunes, 6);

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
                `SELECT sorteo, fecha FROM ${tabla} WHERE fecha BETWEEN ? AND ? ORDER BY fecha, sorteo`,
                [fechaLunes, fechaFin]
            );
            const sorteosSemana = rows.map(r => {
                const nnn = normalizeSorteo(r.sorteo);
                return sorteoKeyFromFecha(nnn, r.fecha) || nnn;
            });

            const premiosRows = await conn.query(
                `SELECT DISTINCT sorteo FROM premios_sorteos WHERE tipoApuesta = ? AND fecha BETWEEN ? AND ?`,
                [nombre, fechaLunes, fechaFin]
            );
            const sorteosConPremios = premiosRows.map(r => r.sorteo?.toString().trim() || "");

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
