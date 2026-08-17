import { procesarSemana } from '../verify-week.js';
import dotenv from 'dotenv';
const envPath = process.env.ENV_FILE || '.env_family';
dotenv.config({ path: envPath });
(async () => {
  const fecha = process.argv[2] || '2026-06-15';
  const res = await procesarSemana(fecha, { autoUpdate: false });
  console.log('--- RESUMEN ---\n');
  console.log(res.resumenFinal);
})();
