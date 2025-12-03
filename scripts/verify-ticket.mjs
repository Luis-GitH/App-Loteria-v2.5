#!/usr/bin/env node
import 'dotenv/config';
import mariadb from 'mariadb';
import { dividirCadena, parseNumberOrNull, formatEuroText } from '../src/helpers/funciones.js';

function arg(name, def = null) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
}

const tipo = (arg('tipo', '') || '').toLowerCase();
const comb = arg('comb') || arg('nums') || '';
const est = arg('est') || '';
const reintegro = arg('reintegro') || arg('r') || '';
const complementario = arg('complementario') || arg('c') || '';
const clave = arg('clave') || '';
const fecha = arg('fecha') || '';
const sorteoArg = arg('sorteo') || '';

function printHelp() {
  console.log(`Uso:
  verify-ticket --tipo=euromillones|primitiva|gordo --fecha=YYYY-MM-DD --comb=... [--est=..|--r=.. --c=..|--clave=..] [--sorteo=NNN]

Alias npm:
  npm run verify:gordo -- --fecha=YYYY-MM-DD --comb=0522363950 --clave=09
  npm run verify:primi -- --fecha=YYYY-MM-DD --comb=010203040506 --r=7 --c=11
  npm run verify:eurom -- --fecha=YYYY-MM-DD --comb=0102030411 --est=0207

Ejemplos:
  Gordo:        node scripts/verify-ticket.mjs --tipo=gordo --fecha=2025-10-12 --comb=0522363950 --clave=09
  Primitiva:    node scripts/verify-ticket.mjs --tipo=primitiva --fecha=2025-11-06 --comb=010203040506 --r=7 --c=11
  Euromillones: node scripts/verify-ticket.mjs --tipo=euromillones --fecha=2025-11-07 --comb=0102030411 --est=0207`);
}

if (process.argv.includes('--help') || process.argv.includes('-h') || !tipo || !fecha || !comb) {
  printHelp();
  if (!tipo || !fecha || !comb) process.exit(1);
}

function parseList(str) {
  const s = (str || '').toString().trim();
  if (!s) return [];
  if (/[ ,;]/.test(s)) return s.split(/[ ,;]+/).filter(Boolean).map((x) => `${Number(x)}`);
  return dividirCadena(s, 2);
}

function normNum(x) {
  const n = parseInt((x ?? '').toString().trim(), 10);
  return Number.isFinite(n) ? String(n) : '';
}

const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  connectionLimit: 5,
});

async function main() {
  const conn = await pool.getConnection();
  try {
    if (tipo === 'euromillones') {
      const [s] = await conn.query('SELECT * FROM r_euromillones WHERE fecha=? LIMIT 1', [fecha]);
      if (!s) throw new Error('No hay resultado de Euromillones para esa fecha');
      const numerosB = parseList(comb);
      const estrellasB = parseList(est);
      const numerosS = parseList(s.numeros);
      const estrellasS = parseList(s.estrellas);
      const aciertosNumeros = numerosB.filter((n) => numerosS.includes(n)).length;
      const aciertosEstrellas = estrellasB.filter((e) => estrellasS.includes(e)).length;
      const tabla = [
        { n: 5, e: 2, cat: '1ª' },
        { n: 5, e: 1, cat: '2ª' },
        { n: 5, e: 0, cat: '3ª' },
        { n: 4, e: 2, cat: '4ª' },
        { n: 4, e: 1, cat: '5ª' },
        { n: 3, e: 2, cat: '6ª' },
        { n: 4, e: 0, cat: '7ª' },
        { n: 2, e: 2, cat: '8ª' },
        { n: 3, e: 1, cat: '9ª' },
        { n: 3, e: 0, cat: '10ª' },
        { n: 1, e: 2, cat: '11ª' },
        { n: 2, e: 1, cat: '12ª' },
      ];
      const found = tabla.find((t) => t.n === aciertosNumeros && t.e === aciertosEstrellas);
      const sorteoNNN = (s.sorteo || '').toString();
      const aciertosKey = `${aciertosNumeros}+${aciertosEstrellas}`;
      const premio = await conn.query(
        `SELECT categoria, premio, premio_text FROM premios_sorteos WHERE tipoApuesta='euromillones' AND sorteo=? AND aciertos=? LIMIT 1`,
        [sorteoNNN, aciertosKey]
      );
      console.log(JSON.stringify({ tipo, fecha, sorteo: sorteoNNN, aciertosNumeros, aciertosEstrellas, categoria: found?.cat || null, premio: premio[0]?.premio_text || null }, null, 2));
    } else if (tipo === 'primitiva') {
      const [s] = await conn.query('SELECT * FROM r_primitiva WHERE fecha=? LIMIT 1', [fecha]);
      if (!s) throw new Error('No hay resultado de Primitiva para esa fecha');
      const numerosB = parseList(comb);
      const numerosS = parseList(s.numeros);
      const aciertosNumeros = numerosB.filter((n) => numerosS.includes(n)).length;
      // El complementario solo aplica cuando tienes 5 aciertos en los 6 números
      const aciertoComplementario = (aciertosNumeros === 5 && numerosB.includes(normNum(s.complementario))) ? 1 : 0;
      const aciertoReintegro = normNum(reintegro) !== '' && normNum(reintegro) === normNum(s.reintegro) ? 1 : 0;
      let cat = null;
      if (aciertosNumeros === 6 && aciertoReintegro === 1) cat = 'Especial (6 Aciertos + Reintegro)';
      else if (aciertosNumeros === 6) cat = '1ª';
      else if (aciertosNumeros === 5 && aciertoComplementario === 1) cat = '2ª';
      else if (aciertosNumeros === 5) cat = '3ª';
      else if (aciertosNumeros === 4) cat = '4ª';
      else if (aciertosNumeros === 3) cat = '5ª';
      else if (aciertosNumeros < 3 && aciertoReintegro === 1) cat = '6ª';
      const sorteoKey = (s.sorteo || '').toString();
      let aciertosKey = '';
      if (aciertosNumeros === 6 && aciertoReintegro === 1) aciertosKey = '6+R';
      else if (aciertosNumeros === 6) aciertosKey = '6';
      else if (aciertosNumeros === 5 && aciertoComplementario === 1) aciertosKey = '5+C';
      else if (aciertosNumeros === 5) aciertosKey = '5';
      else if (aciertosNumeros === 4) aciertosKey = '4';
      else if (aciertosNumeros === 3) aciertosKey = '3';
      else if (aciertoReintegro === 1) aciertosKey = 'R';
      const premio = aciertosKey
        ? await conn.query(
            `SELECT categoria, premio, premio_text FROM premios_sorteos WHERE tipoApuesta='primitiva' AND sorteo=? AND aciertos=? LIMIT 1`,
            [sorteoKey, aciertosKey]
          )
        : [];
      console.log(JSON.stringify({ tipo, fecha, sorteo: sorteoKey, aciertosNumeros, aciertoComplementario, complementarioSorteo: normNum(s.complementario), aciertoReintegro, reintegroSorteo: normNum(s.reintegro), categoria: cat, premio: premio[0]?.premio_text || null }, null, 2));
    } else if (tipo === 'gordo') {
      const [s] = await conn.query('SELECT * FROM r_gordo WHERE fecha=? LIMIT 1', [fecha]);
      if (!s) throw new Error('No hay resultado de Gordo para esa fecha');
      const numerosB = parseList(comb);
      const numerosS = parseList(s.numeros);
      const setS = new Set(numerosS);
      const aciertosNumeros = numerosB.filter((n) => setS.has(n)).length;
      const aciertoClave = normNum(clave) !== '' && normNum(clave) === normNum(s.numeroClave) ? 1 : 0;
      let aciertosKey = '';
      if (aciertoClave === 1 && aciertosNumeros < 2) aciertosKey = 'R';
      else aciertosKey = `${aciertosNumeros}${aciertoClave ? '+C' : ''}`;
      const sorteoKey = (s.sorteo || '').toString();
      const premio = await conn.query(
        `SELECT categoria, premio, premio_text FROM premios_sorteos WHERE tipoApuesta='gordo' AND sorteo=? AND aciertos=? LIMIT 1`,
        [sorteoKey, aciertosKey]
      );

      let premioNum = premio.length ? parseNumberOrNull(premio[0].premio) : null;
      let premioTexto = premio[0]?.premio_text || null;
      if (aciertoClave === 1 && aciertosKey !== 'R') {
        const reintegroRows = await conn.query(
          `SELECT premio, premio_text FROM premios_sorteos WHERE tipoApuesta='gordo' AND sorteo=? AND aciertos='R' LIMIT 1`,
          [sorteoKey]
        );
        if (reintegroRows.length) {
          const reintegro = parseNumberOrNull(reintegroRows[0].premio);
          if (Number.isFinite(premioNum) && Number.isFinite(reintegro)) {
            premioNum += reintegro;
            premioTexto = formatEuroText(premioNum) || premioTexto;
          } else if (Number.isFinite(reintegro)) {
            premioNum = (Number.isFinite(premioNum) ? premioNum : 0) + reintegro;
            premioTexto = formatEuroText(premioNum) || premioTexto || reintegroRows[0].premio_text || null;
          }
        }
      }
      const catMap = {
        '5+C': '1ª', '5': '2ª', '4+C': '3ª', '4': '4ª', '3+C': '5ª', '3': '6ª', '2+C': '7ª', '2': '8ª', 'R': 'Reintegro',
      };
      const premioSalida = premioTexto || (Number.isFinite(premioNum) ? formatEuroText(premioNum) : null);
      console.log(JSON.stringify({ tipo, fecha, sorteo: sorteoKey, aciertosNumeros, aciertoClave, categoria: catMap[aciertosKey] || null, premio: premioSalida }, null, 2));
    } else {
      throw new Error('Tipo no soportado');
    }
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(2);
  } finally {
    try { (await pool).end?.(); } catch {}
  }
}

main();
