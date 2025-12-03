// run-week-range.js

// #!/usr/bin/env node
import { execSync } from "child_process";
import { ensureAppTimezone, mondayOf, addDays, todayISO } from "../src/helpers/fechas.js";

ensureAppTimezone();

const numWeeks = parseInt(process.argv[2]) || 4;
const extraArgs = process.argv.slice(3).join(" ");

function getMondayWeeksAgo(weeksAgo) {
    const base = addDays(todayISO(), -weeksAgo * 7);
    return mondayOf(base);
}

console.log(
    `🔄 Ejecutando verificación para las últimas ${numWeeks} semanas...\n`
);

for (let w = 0; w < numWeeks; w++) {
    const monday = getMondayWeeksAgo(w);
    const cmd = `node verify-week.js --fecha=${monday} ${extraArgs}`;
    console.log(`▶️ [${w + 1}/${numWeeks}] ${cmd}`);
    try {
        execSync(cmd, { stdio: "inherit" });
    } catch (err) {
        console.error(`❌ Error ejecutando semana ${monday}:`, err.message);
    }
}
