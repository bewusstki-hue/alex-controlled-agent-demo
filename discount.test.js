import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDiscount } from './discount.js';

test('zieht einen prozentualen Rabatt vom Preis ab', () => {
  assert.equal(applyDiscount(100, 20), 80);
  assert.equal(applyDiscount(50, 10), 45);
});
