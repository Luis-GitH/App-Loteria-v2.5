import test from 'node:test';
import assert from 'node:assert/strict';
import { extraerJokerDesdeTexto, extraerJokerDesdeHtml } from '../src/modules/scrapers/primitiva.js';

test('extrae el joker cuando viene con espacios y ceros iniciales', () => {
  const texto = 'El resultado del sorteo incluye Joker: 0 334 540';
  assert.equal(extraerJokerDesdeTexto(texto), '0334540');
});

test('extrae el joker cuando viene sin separadores', () => {
  const texto = 'Joker 0334540';
  assert.equal(extraerJokerDesdeTexto(texto), '0334540');
});

test('extrae el joker desde la meta description del HTML de La Primitiva', () => {
  const html = `<!doctype html><html><head><meta name="Description" content="Resultados de La Primitiva del 16 de julio de 2026, Números: 1,6,11,27,31,38 Complementario: 41 Reintegro: 0 Joker: 6168299."></head><body>Resultados de la Primitiva</body></html>`;
  assert.equal(extraerJokerDesdeHtml(html), '6168299');
});

test('no confunde otros números del resultado con el Joker', () => {
  const texto = 'Números: 7, 11, 14, 22, 41, 44. Complementario: 2. Reintegro: 5.';
  assert.equal(extraerJokerDesdeTexto(texto), '');
});

test('rechaza un Joker incompleto', () => {
  assert.equal(extraerJokerDesdeTexto('Joker: 123456.'), '');
});
