import test from 'node:test';
import assert from 'node:assert/strict';

import { calcularCategoriaJoker, cmpPrimitiva, premioJokerPorCategoria } from '../src/helpers/premios.js';

test('detecta la sexta categoría del Joker por las dos últimas cifras', () => {
  assert.equal(calcularCategoriaJoker('6309765', '2095565'), 6);
  const cmp = cmpPrimitiva(
    { combinacion: '', reintegro: '', joker: '6309765' },
    { numeros: '', complementario: '', reintegro: '', joker: '2095565' },
  );
  assert.equal(cmp.aciertoJoker, 1);
  assert.equal(cmp.categoriaJoker, 6);
  assert.deepEqual(premioJokerPorCategoria(cmp.categoriaJoker), {
    aciertos: 'J',
    categoria: 'Joker 6ª',
    premio: 5,
    premio_text: '5,00 €',
    pendiente: false,
  });
});

test('prioriza la categoría más alta y acepta coincidencias por inicio o final', () => {
  assert.equal(calcularCategoriaJoker('1234567', '1234567'), 1);
  assert.equal(calcularCategoriaJoker('1234567', '1234560'), 2);
  assert.equal(calcularCategoriaJoker('9234567', '1234567'), 2);
  assert.equal(calcularCategoriaJoker('9000000', '1234567'), null);
});
