import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { claimNextJob, seedJobs, setStorePath } from './jobQueue.js';
import { countJobsByPriority } from './jobQueueStats.js';

function freshStore() {
  const dir = mkdtempSync(path.join(tmpdir(), 'jobqueue-test-'));
  setStorePath(path.join(dir, 'jobs.json'));
}

test('countJobsByPriority zaehlt offene und reservierte Jobs pro Prioritaet', async () => {
  freshStore();
  seedJobs([
    { id: 'h1', status: 'open', priority: 'high' },
    { id: 'h2', status: 'reserved', priority: 'high' },
    { id: 'n1', status: 'open', priority: 'normal' },
    { id: 'l1', status: 'reserved', priority: 'low' },
    { id: 'l2', status: 'open', priority: 'low' },
  ]);
  const stats = await countJobsByPriority();
  assert.deepEqual(stats, {
    high: { open: 1, reserved: 1 },
    normal: { open: 1, reserved: 0 },
    low: { open: 1, reserved: 1 },
  });
});

test('countJobsByPriority behandelt Jobs ohne Priority als normal', async () => {
  freshStore();
  seedJobs([
    { id: 'x1', status: 'open' },
    { id: 'x2', status: 'reserved' },
  ]);
  const stats = await countJobsByPriority();
  assert.deepEqual(stats, {
    high: { open: 0, reserved: 0 },
    normal: { open: 1, reserved: 1 },
    low: { open: 0, reserved: 0 },
  });
});

test('countJobsByPriority reflektiert tatsaechliche Reservierungen', async () => {
  freshStore();
  seedJobs([
    { id: 'h1', status: 'open', priority: 'high' },
    { id: 'l1', status: 'open', priority: 'low' },
  ]);
  await claimNextJob('worker-a');
  const stats = await countJobsByPriority();
  assert.deepEqual(stats, {
    high: { open: 0, reserved: 1 },
    normal: { open: 0, reserved: 0 },
    low: { open: 1, reserved: 0 },
  });
});
