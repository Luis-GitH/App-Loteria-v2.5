#!/usr/bin/env node
import axios from 'axios';
import * as cheerio from 'cheerio';

const fecha = process.argv[2] || '2025-11-10';
const [Y,M,D] = fecha.split('-');
const slug = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'][new Date(Number(Y),Number(M)-1,Number(D)).getDay()];
const dia = `${D}-${M}-${Y}`;
const url = `https://www.laprimitiva.info/loteriaprimitiva/Sorteo-${dia}-${slug}.html`;
const HEADERS = { 'User-Agent':'Mozilla/5.0', 'Accept-Language':'es-ES,es;q=0.9' };

console.log('URL', url);
const {data:html} = await axios.get(url, { headers: HEADERS });
const $ = cheerio.load(html);
const meta = $('meta[name="Description"], meta[name="description"]').attr('content')||'';
console.log('has meta?', !!meta, 'sample:', meta.slice(0,180));
const body = $('body').text();
console.log('comp?', /complementario\D*(\d{1,2})/i.test(body), 'rein?', /reintegro\D*(\d)/i.test(body));
