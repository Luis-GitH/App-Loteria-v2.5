/*//////////////////////////////////////////////////
🚀 process_ticket.v4.js funciona todo correctamente.
==================================================
📠 Escaneo vía WIA (--scan) o recorte desde imagen existente (--cut)
🔍 Lectura QR (--qr)
💾 Inserción opcional en MariaDB (--db)
==================================================*/

// --- Dependencias principales ---
import path from "path";
import fse from "fs-extra";
// import { fileURLToPath } from "url";

// --- Módulos propios ---
import { scanAndCutBoletos } from "./src/modules/scan_boletos.js";
import { parseTicketQR } from "./src/modules/parse_ticket_qr.js";
import { guardarBoletoProcesado } from "./src/modules/boletosToDB.js";
import { decodeQRFromImage } from "./src/modules/read_qr_from_scans.js";
import {
    procesarBoletosDesdeJSON,
    cerrarPool,
} from "./src/modules/boletosToDB.js";
// --- Configuración de rutas ---
const ROOT = path.resolve();
const APP_VARIANT = (
    process.env.APP_VARIANT ||
    (process.env.PM2_APP_NAME &&
    process.env.PM2_APP_NAME.startsWith("app-")
        ? process.env.PM2_APP_NAME.slice(4)
        : process.env.PM2_APP_NAME) ||
    "cre"
).toLowerCase();
const SCANS_DIR = path.join(ROOT, "src", "scans");
const UPLOADS_DIR = path.join(ROOT, "src", "uploads");
const PROCESADOS_DIR = path.join(ROOT, "src", "procesadosQR");
const LOG_DIR = path.join(ROOT, "logs");
const HISTORICO_DIR = path.join(ROOT, "data", `historico-${APP_VARIANT}`);
// --- Asegurar directorios ---
await fse.ensureDir(SCANS_DIR);
await fse.ensureDir(UPLOADS_DIR);
await fse.ensureDir(PROCESADOS_DIR);
await fse.ensureDir(LOG_DIR);
await fse.ensureDir(HISTORICO_DIR);

// --- Argumentos ---
const args = process.argv.slice(2);
const useScanner = args.includes("--scan");
const useCut = args.includes("--cut");
const processQR = args.includes("--qr");
const sendToDB = args.includes("--db");
const desarrollo = args.includes("--dev");
// --- Banner informativo ---
console.log("========================================");
console.log("🎯 Iniciando proceso de boletos");
console.log(
    `📠 Escaneo: ${useScanner ? "Sí" : "No"} | ✂️ Corte: ${
        useCut ? "Sí" : "No"
    } | 🔍 Leer QR: ${processQR ? "Sí" : "No"} | 💾 Base de datos: ${
        sendToDB ? "Sí" : "No"
    } | 💾 desarrollo: ${desarrollo ? "Sí" : "No"}`
);
console.log("========================================\n");

// ====================================================================
// 🚀 Proceso principal
// ====================================================================
// 1️⃣ Escanear y/o recortar boletos
// ====================================================================
if (useScanner || useCut) {
    console.log(
        useScanner ? "📥 Escaneando boletos..." : "✂️ Cortando boletos..."
    );

    await scanAndCutBoletos({ onlyCut: useCut });
}

// ====================================================================
// 2️⃣ Procesar los boletos en /scr/uploads y leer QR  (BLOQUE NUEVO)
// ====================================================================
if (processQR) {
    console.log("🔍 Iniciando lectura de QR en /scr/uploads...\n");

    let archivos = await fse.readdir(UPLOADS_DIR);
    const imagenes = archivos.filter((f) =>
        [".png", ".jpg", ".jpeg"].includes(path.extname(f).toLowerCase())
    );

    if (imagenes.length === 0) {
        console.log("⚠️ No hay boletos en /src/uploads para procesar.");
    } else {
        let totalOk = 0,
            totalFail = 0;

        for (const archivo of imagenes) {
            const filePath = path.join(UPLOADS_DIR, archivo);
            console.log(`📄 Procesando ${archivo}...`);

            try {
                const qrData = await decodeQRFromImage(filePath);
                if (!qrData) {
                    console.log(`❌ ${archivo}: sin QR detectado.`);
                    totalFail++;
                    continue;
                }

                console.log("🧩 Parseando QR...");
                const boleto = parseTicketQR(qrData); // ⚠️ SIN await
                if (!boleto) {
                    console.log(`⚠️ ${archivo}: QR no válido o no reconocido.`);
                    totalFail++;
                    continue;
                }
                console.log("✅ Parseo completado.");

                // Guardar JSON
                const newBoletoName = `${boleto.fechaLunes}_${
                    boleto.tipo
                }_${boleto.identificador.slice(-5)}${path.extname(archivo)}`;

                boleto.imagen = path.normalize(
                    path.join(PROCESADOS_DIR, newBoletoName)
                );

                const jsonName =
                    path.basename(newBoletoName, path.extname(newBoletoName)) +
                    ".json";
                const jsonPath = path.join(PROCESADOS_DIR, jsonName);

                await fse.writeJson(jsonPath, boleto, { spaces: 2 });

                console.log(`📦 JSON → ${jsonName}`);
                /// hasta aqui el procesado qr del boleto y su conversion a jsn
                totalOk++;
                // Mover imagen al directorio procesados
                const newImageName = `${boleto.fechaLunes}_${
                    boleto.tipo
                }_${boleto.identificador.slice(-5)}${path.extname(archivo)}`;
                const newImagePath = path.join(PROCESADOS_DIR, newBoletoName);
                await fse.move(filePath, newImagePath, { overwrite: true });

                boleto.imagen = path.basename(newImagePath);
            } catch (err) {
                console.error(`❌ Error procesando ${archivo}:`, err.message);
                totalFail++;
            }
        }
        console.log(
            `\n📊 Resumen QR → OK: ${totalOk}, Fallidos: ${totalFail}, Total: ${
                totalOk + totalFail
            }`
        );
    }
}
//aqui termina el bloque nuevo de procesamiento de qr
//guardamos en la bas de datos si se ha indicado
if (sendToDB) {
    const archivos = await fse.readdir(PROCESADOS_DIR);
    const jsonFiles = archivos.filter((f) =>
        [".json"].includes(path.extname(f).toLowerCase())
    );
    if (jsonFiles.length === 0) {
        console.log("⚠️ No hay boletos en /procesadosQR para procesar.");
    } else {
        for (const jsonFile of jsonFiles) {
            try {
                // jsonfullPath del archivo JSON para moverlo después
                const jsonfullpath = path.join(PROCESADOS_DIR, jsonFile);

                const data = await fse.readFile(jsonfullpath, "utf8");
                const boleto = JSON.parse(data);

                //cogemos el nombre de la imagen para moverla también
                const Imagefullpath = boleto.imagen;
                const extension = path.extname(Imagefullpath);

                // creamos el nuevo nombre para imagen y json
                const newName = `Boleto_${boleto.fechaLunes}_${
                    boleto.tipo
                }_${boleto.identificador.slice(-5)}`;
                // lo grabamo en el boleto.json
                const fileDestPath = path.join(HISTORICO_DIR, newName + extension);
                boleto.imagen = newName + extension;
                await guardarBoletoProcesado(boleto);
                // mover a histórico json
                let destino = path.join(HISTORICO_DIR, newName + ".json");
                await fse.move(jsonfullpath, destino, { overwrite: true });
                await fse.move(Imagefullpath, fileDestPath, { overwrite: true });
            } catch (e) {
                console.error("Error al parsear el JSON:", e);
            }
        }
    }
}
await cerrarPool();
