#!/usr/bin/env node
import { execSync } from "child_process";
import { ensureAppTimezone, mondayOf, todayISO } from "../src/helpers/fechas.js";

ensureAppTimezone();

const monday = mondayOf(todayISO());
const extraArgs = process.argv.slice(2).join(" ");

const cmd = `node verify-week.js --fecha=${monday} ${extraArgs}`;
console.log(`▶️ Ejecutando semana actual detectada: ${cmd}\n`);
execSync(cmd, { stdio: "inherit" });
