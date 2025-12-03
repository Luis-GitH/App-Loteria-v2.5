#!/usr/bin/env node
import 'dotenv/config';
import { scrapeResultadosPrimitivaByFecha } from '../src/modules/scrapers/primitiva.js';
import { ensureAppTimezone, todayISO } from '../src/helpers/fechas.js';

ensureAppTimezone();

const fecha = process.argv[2] || todayISO();
console.log('Test scrape Primitiva fecha =', fecha);
try {
  const res = await scrapeResultadosPrimitivaByFecha(fecha);
  console.log('Resultado retorno =', res);
} catch (e) {
  console.error('Error:', e.stack || e.message);
}
