// ====================================================================
// 📦 Módulo: read_qr_from_scans.js
// Decodifica códigos QR desde imágenes PNG/JPG usando jsQR + canvas
// ====================================================================

import { createCanvas, loadImage } from "canvas";
import jsQR from "jsqr";

export async function decodeQRFromImage(filePath) {
  try {
    // Cargar imagen de forma asíncrona y segura
    const img = await loadImage(filePath);

    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, img.width, img.height);

    const imageData = ctx.getImageData(0, 0, img.width, img.height);

    // Ejecutar jsQR
    const qr = jsQR(imageData.data, img.width, img.height, {
      inversionAttempts: "attemptBoth",
    });

    if (qr && qr.data) {
      console.log(`✅ QR detectado en ${filePath}`);
      return qr.data.trim();
    } else {
      console.log(`❌ No se detectó ningún QR en ${filePath}`);
      return null;
    }
  } catch (err) {
    console.error(`⚠️ Error leyendo QR en ${filePath}:`, err.message);
    return null;
  }
}

