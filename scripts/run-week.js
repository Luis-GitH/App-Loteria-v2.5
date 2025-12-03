#!/usr/bin/env node
import { execSync } from "child_process";
import { ensureAppTimezone, mondayOf, todayISO } from "../src/helpers/fechas.js";

ensureAppTimezone();

// Calcula el lunes de la semana actual
function getMondayISO() {
    return mondayOf(todayISO());
}

const monday = getMondayISO();

// Pasar flags opcionales que se añadan tras npm run week
const extraArgs = process.argv.slice(2).join(" ");

// Comando final
const cmd = `node verify-week.js --fecha=${monday} ${extraArgs}`;
console.log(`▶️ Ejecutando: ${cmd}\n`);

try {
    execSync(cmd, { stdio: "inherit" });
} catch (err) {
    console.error("❌ Error ejecutando verify-week:", err.message);
    process.exit(1);
}
