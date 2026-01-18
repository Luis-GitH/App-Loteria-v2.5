#!/usr/bin/env node
import { runVerifyWeek } from "./verify-week.js";

// Usa argumentos distintos según el día: lunes incluye --users, otros días no.
const today = new Date();
const isMonday = today.getDay() === 1; // 0 = domingo, 1 = lunes
const isSunday = today.getDay() === 0; // 0 = domingo

const FIXED_ARGS = isSunday
    ? ["--week", "--all", "--users"]
    : ["--week", "--all"];

runVerifyWeek(FIXED_ARGS).catch((err) => {
    console.error("❌ verify-week-fixed error:", err?.stack || err);
    process.exitCode = 1;
});
