import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampValue } from './mathUtils.js';

test('gueltiger Bereich: Wert innerhalb [min, max] wird unveraendert zurueckgegeben', () => {
  assert.equal(clampValue(5, 0, 10), 5);
  assert.equal(clampValue(0, 0, 10), 0);
  assert.equal(clampValue(10, 0, 10), 10);
});

test('Wert unter min wird auf min begrenzt', () => {
  assert.equal(clampValue(-3, 0, 10), 0);
  assert.equal(clampValue(-100, -50, 50), -50);
});

test('Wert ueber max wird auf max begrenzt', () => {
  assert.equal(clampValue(42, 0, 10), 10);
  assert.equal(clampValue(100, -50, 50), 50);
});

test('ungueltige min/max-Kombination (min > max) wirft einen Fehler', () => {
  assert.throws(() => clampValue(5, 10, 0), RangeError);
  assert.throws(() => clampValue(5, 5, 4), /min/);
});

test('NaN-Eingaben werfen einen Fehler statt falsche Grenzen zu liefern', () => {
  assert.throws(() => clampValue(NaN, 0, 10), TypeError);
  assert.throws(() => clampValue(5, NaN, 10), TypeError);
  assert.throws(() => clampValue(5, 0, NaN), TypeError);
});

test('Infinity-Grenzen sind zulaessig und geben value unveraendert zurueck', () => {
  assert.equal(clampValue(5, -Infinity, Infinity), 5);
  assert.equal(clampValue(Infinity, 0, 10), 10);
});
