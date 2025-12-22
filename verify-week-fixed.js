#!/usr/bin/env node
import { runVerifyWeek } from "./verify-week.js";

// Ejecuta verify-week con los argumentos fijos para cron/PM2
const FIXED_ARGS = ["--week", "--all", "--users"];

runVerifyWeek(FIXED_ARGS).catch((err) => {
    console.error("❌ verify-week-fixed error:", err?.stack || err);
    process.exitCode = 1;
});

