import fs from 'fs';
import { parseTicketQR } from '../src/modules/parse_ticket_qr.js';

const path = './data/historico-family/Boleto_2026-06-08_euromillones_54562.json';
const obj = JSON.parse(fs.readFileSync(path,'utf8'));
console.log('sorteoCodigo:', obj.sorteoCodigo);
const parsed = parseTicketQR(`A=${obj.identificador};P=7;S=${obj.sorteoCodigo};W=${obj.semanas};.1=${obj.combinacion}:${obj.estrellas};T=${obj.terminal}`);
console.log(JSON.stringify(parsed, null, 2));
console.log('\nOriginal:');
console.log(JSON.stringify(obj.sorteos, null, 2));
function diff(a,b){return JSON.stringify(a)===JSON.stringify(b)?'Iguales':'DIF';}
console.log('\nComparación:',diff(parsed.sorteos,obj.sorteos));
