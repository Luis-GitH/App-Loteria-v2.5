// ====================================================================
// 📦 Módulo: scan_boletos.js version:1.0 verificadas la entradas y resultados
// DOs opciones:
// 1) Escanea boletos (WIA) del scanner y lo pone en SCAN/ 
// 2) Recorta las imagenes que hay en SCAN/ y las recorta como boletos
//    independientes y los pone en UPLOADS/ con el formato: YYYYMMDDHHMM_n.png
// Usa OpenCV.js (sin dependencias nativas).
// ====================================================================

import { createCanvas, Image, ImageData } from "canvas";
globalThis.HTMLCanvasElement = createCanvas(1, 1).constructor;
globalThis.HTMLImageElement = Image;
globalThis.ImageData = ImageData;

import cv from "@techstark/opencv-js";
import { execFile } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import fse from "fs-extra";
import path from "path";
import { ensureAppTimezone } from "../helpers/fechas.js";
import { format } from "date-fns";

ensureAppTimezone();

const ROOT = path.resolve();
const TEMP_DIR = path.join(ROOT, "src", "temp");
const SCANS_DIR = path.join(ROOT, "src", "scans");
const UPLOADS_DIR = path.join(ROOT, "src", "uploads");

await fse.ensureDir(TEMP_DIR);
await fse.ensureDir(SCANS_DIR);
await fse.ensureDir(UPLOADS_DIR);

const TEMP_SCAN = path.join(TEMP_DIR, "scan.png");
const TEMP_RAW = path.join(TEMP_DIR, "scan_raw.bmp");

const CONFIG = {
  blur: 5,
  morphKernel: 5,
  thresholdBlockSize: 51,
  thresholdC: 15,
  minAreaRatio: 0.01,
  pad: 10,
  deskewMinAngle: 0.8,
};

// ====================================================================
// 📠 Escanear con WIA
// ====================================================================
export async function scanWithWIA() {
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32")
      return reject(new Error("WIA solo disponible en Windows."));

    const psScript = `
      $deviceManager = New-Object -ComObject WIA.DeviceManager
      $device = $deviceManager.DeviceInfos | Where-Object { $_.Type -eq 1 } | Select-Object -First 1
      if ($device -eq $null) { exit 2 }
      $connected = $device.Connect()
      $item = $connected.Items.Item(1)
      $image = $item.Transfer()
      $image.SaveFile('${TEMP_RAW.replace(/\\/g, "/")}')
      Add-Type -AssemblyName System.Drawing
      $bmp = [System.Drawing.Image]::FromFile('${TEMP_RAW.replace(/\\/g, "/")}')
      $bmp.Save('${TEMP_SCAN.replace(/\\/g, "/")}', [System.Drawing.Imaging.ImageFormat]::Png)
      $bmp.Dispose()
    `;

    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psScript],
      { windowsHide: true },
      (error) => {
        if (error) {
          if (error.code === 2)
            reject(new Error("No se encontró ningún escáner WIA."));
          else reject(error);
        } else {
          if (!existsSync(TEMP_SCAN))
            return reject(new Error("No se generó temp_scan.png."));
          // borramos el bmp temporal
          fse.unlinkSync(TEMP_RAW);
          console.log("📠 Escaneo completado:", TEMP_SCAN);
          resolve(TEMP_SCAN);
        }
      }
    );
  });
}

// ====================================================================
// ✂️ Procesar y recortar boletos desde una imagen
// ====================================================================
export async function cutBoletosFromImage(imagePath = TEMP_SCAN) {
  console.log(`✂️ Procesando boletos desde: ${path.basename(imagePath)}`);

  if (!existsSync(imagePath))
    throw new Error(`La imagen no existe: ${imagePath}`);

  const image = loadImageToMat(imagePath);
  const gray = new cv.Mat();
  cv.cvtColor(image, gray, cv.COLOR_RGBA2GRAY);
  const blurred = new cv.Mat();
  cv.GaussianBlur(gray, blurred, new cv.Size(CONFIG.blur, CONFIG.blur), 0);

  const thresh = new cv.Mat();
  cv.adaptiveThreshold(
    blurred,
    thresh,
    255,
    cv.ADAPTIVE_THRESH_GAUSSIAN_C,
    cv.THRESH_BINARY_INV,
    CONFIG.thresholdBlockSize,
    CONFIG.thresholdC
  );

  const kernel = cv.Mat.ones(CONFIG.morphKernel, CONFIG.morphKernel, cv.CV_8U);
  const closed = new cv.Mat();
  cv.morphologyEx(thresh, closed, cv.MORPH_CLOSE, kernel);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  console.log(`📦 Contornos detectados: ${contours.size()}`);

  const totalArea = image.cols * image.rows;
  let count = 0;

  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const area = cv.contourArea(cnt);
    if (area < totalArea * CONFIG.minAreaRatio) continue;

    const rect = cv.boundingRect(cnt);
    const x = Math.max(0, rect.x - CONFIG.pad);
    const y = Math.max(0, rect.y - CONFIG.pad);
    const w = Math.min(image.cols - x, rect.width + CONFIG.pad * 2);
    const h = Math.min(image.rows - y, rect.height + CONFIG.pad * 2);

    const roi = image.roi(new cv.Rect(x, y, w, h));
//
    const now = new Date();
    const timestamp = format(now, "yyyyMMddHHmm");
    const index = String(count + 1).padStart(2, "0");
    const outName = `Boleto_${timestamp}_${index}.png`;
//    const outName = `scan_boleto_${Date.now()}_${String(count + 1).padStart(2, "0")}.png`;
    const outPath = path.join(UPLOADS_DIR, outName);
    saveMat(roi, outPath);

    count++;
    roi.delete();
  }

  console.log(`✅ ${count} boletos guardados en /uploads`);
  image.delete();
  gray.delete();
  blurred.delete();
  thresh.delete();
  closed.delete();
  kernel.delete();
  contours.delete();
  hierarchy.delete();
}


// ====================================================================
// 📥 Función principal: --scan => scan + cut múltiples imágenes
//                        --cut recorta las imagenes que haya en temp y las borra
// ====================================================================
// import fse from "fs-extra";


// const TEMP_SCAN = path.join(TEMP_DIR, "scan.png");

export async function scanAndCutBoletos({ onlyCut = false } = {}) {
  try {
    // Si no existe el directorio temp, lo creamos
    fse.ensureDirSync(TEMP_DIR);
    if (!onlyCut) {
      console.log("📠 Escaneando un nuevo boleto...");
      const filePath = await scanWithWIA();
      await cutBoletosFromImage(filePath);
      return;
    }

    // ----------------------------------------------------------------
    // 🧩 Modo "solo cortar": procesar todos los .jpg y .png en /temp
    // ----------------------------------------------------------------
      
      // Define las extensiones permitidas en un array
      const allowedExtensions = ['.jpg', '.png'];
      
      const archivos = fse
      .readdirSync(TEMP_DIR)
      .filter((file) => {
        const fileExtension = path.extname(file).toLowerCase();
        return allowedExtensions.includes(fileExtension);
      });
      
      if (archivos.length === 0) {
        console.log("⚠️ No hay imágenes .png en /temp para procesar.");
        return;
      }

    console.log(`✂️ Procesando ${archivos.length} archivo(s) desde /temp...\n`);

    for (const [i, file] of archivos.entries()) {
      const filePath = path.join(TEMP_DIR, file);
      console.log(`📄 [${i + 1}/${archivos.length}] Cortando → ${file}`);
      try {
        await cutBoletosFromImage(filePath);
      } catch (err) {
        console.warn(`⚠️ Error procesando ${file}: ${err.message}`);
      }
    }

    console.log("✅ Proceso de corte múltiple completado.");
  } catch (err) {
    console.error("❌ Error en scanAndCutBoletos:", err.message);
  }
}


// ====================================================================
// 🧩 Utilidades internas
// ====================================================================
function loadImageToMat(filePath) {
  const data = readFileSync(filePath);
  const img = new Image();
  img.src = data;
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const imgData = ctx.getImageData(0, 0, img.width, img.height);
  return cv.matFromImageData(imgData);
}

function saveMat(mat, filePath) {
  const canvas = createCanvas(mat.cols, mat.rows);
  cv.imshow(canvas, mat);
  const buffer = canvas.toBuffer("image/png");
  writeFileSync(filePath, buffer);
}
