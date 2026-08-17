import fs from 'fs';
import { parseTicketQR } from '../src/modules/parse_ticket_qr.js';

const path = './data/historico-family/Boleto_2026-06-15_primitiva_38763.json';
const raw = fs.readFileSync(path, 'utf8');
const obj = JSON.parse(raw);
console.log('Archivo:', path);
console.log('sorteoCodigo (desde archivo):', obj.sorteoCodigo);
const parsed = parseTicketQR(`A=${obj.identificador};P=1;S=${obj.sorteoCodigo};W=${obj.semanas};.1=${obj.combinacion}:${obj.reintegro};T=${obj.terminal}`);
console.log('\nResultado del parser actualizado:');
console.log(JSON.stringify(parsed, null, 2));

console.log('\nSorteos en archivo original:');
console.log(JSON.stringify(obj.sorteos, null, 2));

function simpleDiff(a, b) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa === sb) return 'Iguales';
  return 'DIFERENTES';
}
console.log('\nComparación sorteos:', simpleDiff(obj.sorteos, parsed.sorteos));
