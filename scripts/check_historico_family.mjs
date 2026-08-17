import fs from 'fs';
import path from 'path';
import { parseTicketQR } from '../src/modules/parse_ticket_qr.js';

const dir = './data/historico-family';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
let total = 0, iguales = 0, dif = 0;
const discrepantes = [];
for (const f of files) {
  total++;
  const p = path.join(dir, f);
  try {
    const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
    const tipoMap = { primitiva: '1', gordo: '4', euromillones: '7' };
    const pCode = obj.sorteoCodigo || '';
    const pTipo = tipoMap[obj.tipo] || '1';
    const qr = `A=${obj.identificador};P=${pTipo};S=${pCode};W=${obj.semanas || 1};.1=${obj.combinacion}:${obj.reintegro || ''};T=${obj.terminal || ''}`;
    const parsed = parseTicketQR(qr);
    const left = JSON.stringify(obj.sorteos || []);
    const right = JSON.stringify((parsed && parsed.sorteos) || []);
    if (left === right) {
      iguales++;
    } else {
      dif++;
      discrepantes.push({ file: f, identificador: obj.identificador, tipo: obj.tipo, sorteos_file: obj.sorteos || [], sorteos_parsed: (parsed && parsed.sorteos) || [] });
    }
  } catch (e) {
    console.error('ERROR reading', f, e.message);
  }
}
console.log(`TOTAL=${total} IGUALES=${iguales} DIF=${dif}`);
if (discrepantes.length) {
  console.log('--- DISCREPANTES ---');
  for (const d of discrepantes) {
    console.log(`FILE=${d.file} ID=${d.identificador} TIPO=${d.tipo}`);
    console.log('SORTEOS_FILE=', JSON.stringify(d.sorteos_file));
    console.log('SORTEOS_PARSED=', JSON.stringify(d.sorteos_parsed));
    console.log('-----');
  }
}
