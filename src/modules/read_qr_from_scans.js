// ====================================================================
// 📦 Módulo: read_qr_from_scans.js
// Decodifica códigos QR desde imágenes PNG/JPG usando jsQR + canvas
// ====================================================================

import { createCanvas, loadImage } from "canvas";
import jsQR from "jsqr";

let qrQueue = Promise.resolve();

function decodeCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const qr = jsQR(imageData.data, canvas.width, canvas.height, {
    inversionAttempts: "attemptBoth",
  });
  return qr?.data?.trim() || null;
}

function decodeRegion(img, region, maxSize, filter = "none") {
  const canvas = renderRegion(img, region, maxSize, filter);
  try {
    return decodeCanvas(canvas);
  } finally {
    // node-canvas mantiene memoria nativa fuera del GC de V8. Reducir el
    // backing store permite liberarla al terminar cada intento.
    canvas.width = 0;
    canvas.height = 0;
  }
}

function renderRegion(img, region, maxSize, filter = "none") {
  const { x, y, width, height } = region;
  const scale = Math.min(1, maxSize / Math.max(width, height));
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const canvas = createCanvas(outWidth, outHeight);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.filter = filter;
  ctx.drawImage(img, x, y, width, height, 0, 0, outWidth, outHeight);
  return canvas;
}

async function decodeQRFromImageNow(filePath) {
  try {
    const img = await loadImage(filePath);
    const w = img.width;
    const h = img.height;
    const regions = [
      // Foto completa, reducida para evitar una matriz de 12 megapíxeles.
      { x: 0, y: 0, width: w, height: h },
      // Los resguardos de SELAE sitúan normalmente el QR en la mitad inferior.
      { x: 0, y: Math.round(h * 0.42), width: w, height: Math.round(h * 0.58) },
      { x: 0, y: Math.round(h * 0.48), width: Math.round(w * 0.62), height: Math.round(h * 0.48) },
      // Cuadrantes como respaldo para fotos giradas o con mucho margen.
      { x: 0, y: 0, width: Math.round(w * 0.62), height: Math.round(h * 0.62) },
      { x: Math.round(w * 0.38), y: 0, width: Math.round(w * 0.62), height: Math.round(h * 0.62) },
      { x: Math.round(w * 0.38), y: Math.round(h * 0.38), width: Math.round(w * 0.62), height: Math.round(h * 0.62) },
    ];
    const attempts = [
      { maxSize: 1600, filter: "none" },
      { maxSize: 1200, filter: "grayscale(1) contrast(1.35)" },
    ];

    for (const region of regions) {
      for (const attempt of attempts) {
        const data = decodeRegion(img, region, attempt.maxSize, attempt.filter);
        if (data) {
          console.log(`✅ QR detectado en ${filePath}`);
          return data;
        }
      }
    }

    {
      // Último intento a resolución original solo para imágenes pequeñas.
      if (Math.max(w, h) <= 1800) {
        const data = decodeRegion(img, { x: 0, y: 0, width: w, height: h }, 1800);
        if (data) {
          console.log(`✅ QR detectado en ${filePath}`);
          return data;
        }
      }
    }

    console.log(`❌ No se detectó ningún QR en ${filePath}`);
    return null;
  } catch (err) {
    console.error(`⚠️ Error leyendo QR en ${filePath}:`, err.message);
    return null;
  }
}

export function decodeQRFromImage(filePath) {
  // Procesar una foto cada vez evita multiplicar el pico de memoria cuando
  // varios usuarios suben imágenes grandes simultáneamente.
  const task = qrQueue.then(() => decodeQRFromImageNow(filePath));
  qrQueue = task.catch(() => null);
  return task;
}
