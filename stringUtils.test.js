import { test } from 'node:test';
import assert from 'node:assert/strict';
import { truncateWithEllipsis } from './stringUtils.js';

test('kuerzt einen kurzen String nicht, wenn er in maxLength passt', () => {
  const input = 'Hallo Welt';
  const result = truncateWithEllipsis(input, 20);
  assert.equal(result, input);
  assert.equal(result.length, input.length);
});

test('kuerzt einen langen String auf maxLength inklusive Ellipsis', () => {
  const input = 'Das ist ein sehr langer Text, der gekuerzt werden muss.';
  const maxLength = 20;
  const result = truncateWithEllipsis(input, maxLength);
  assert.equal(result.length, maxLength);
  assert.ok(result.endsWith('...'));
  assert.ok(input.startsWith(result.slice(0, -3)));
});

test('Grenzfall: maxLength gleich Textlaenge liefert den Text unveraendert', () => {
  const input = 'Exakt passend';
  const result = truncateWithEllipsis(input, input.length);
  assert.equal(result, input);
  // Keine Ellipsis, obwohl der String lang genug fuer eine waere.
  assert.equal(result.endsWith('...'), false);
});

test('wirft einen TypeError, wenn text kein String ist', () => {
  assert.throws(() => truncateWithEllipsis(42, 10), TypeError);
  assert.throws(() => truncateWithEllipsis(null, 10), TypeError);
  assert.throws(() => truncateWithEllipsis(undefined, 10), TypeError);
  assert.throws(() => truncateWithEllipsis({}, 10), TypeError);
});

test('wirft einen RangeError, wenn maxLength ungueltig ist (<= 0, NaN, nicht ganzzahlig)', () => {
  assert.throws(() => truncateWithEllipsis('Text', 0), RangeError);
  assert.throws(() => truncateWithEllipsis('Text', -5), RangeError);
  assert.throws(() => truncateWithEllipsis('Text', NaN), RangeError);
  assert.throws(() => truncateWithEllipsis('Text', 3.5), RangeError);
});

test('maxLength kleiner als die Ellipsis: Ergebnis bleibt innerhalb maxLength', () => {
  const result = truncateWithEllipsis('Sehr langer Text', 1);
  assert.equal(result, '.');
  assert.equal(result.length, 1);
});

test('Invariante: Ergebnislaenge ist niemals groesser als maxLength', () => {
  const input = 'abcdefghijklmnopqrstuvwxyz';
  for (let maxLength = 1; maxLength <= input.length + 5; maxLength++) {
    const result = truncateWithEllipsis(input, maxLength);
    assert.ok(
      result.length <= maxLength,
      `maxLength=${maxLength} -> Ergebnislaenge ${result.length} ueberschreitet das Budget`
    );
  }
});
