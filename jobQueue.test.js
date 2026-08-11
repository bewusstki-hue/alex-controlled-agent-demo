import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { claimNextJob, listJobs, seedJobs, setStorePath } from './jobQueue.js';

function freshStore() {
  const dir = mkdtempSync(path.join(tmpdir(), 'jobqueue-test-'));
  setStorePath(path.join(dir, 'jobs.json'));
}

test('claimNextJob reserviert den ersten offenen Job', async () => {
  freshStore();
  seedJobs([{ id: 'j1', status: 'open' }, { id: 'j2', status: 'open' }]);
  const claimed = await claimNextJob('worker-a');
  assert.equal(claimed, 'j1');
  const jobs = await listJobs();
  assert.equal(jobs.find((j) => j.id === 'j1').status, 'reserved');
  assert.equal(jobs.find((j) => j.id === 'j1').workerId, 'worker-a');
});

test('claimNextJob gibt null zurueck wenn nichts offen ist', async () => {
  freshStore();
  seedJobs([{ id: 'j1', status: 'reserved' }]);
  const claimed = await claimNextJob('worker-a');
  assert.equal(claimed, null);
});

test('claimNextJob ueberspringt bereits reservierte Jobs', async () => {
  freshStore();
  seedJobs([{ id: 'j1', status: 'reserved' }, { id: 'j2', status: 'open' }]);
  const claimed = await claimNextJob('worker-b');
  assert.equal(claimed, 'j2');
});

test('claimNextJob vergibt zuerst den Job mit hoechster Prioritaet', async () => {
  freshStore();
  seedJobs([
    { id: 'low1', status: 'open', priority: 'low' },
    { id: 'high1', status: 'open', priority: 'high' },
    { id: 'normal1', status: 'open', priority: 'normal' },
  ]);
  const claimed = await claimNextJob('worker-a');
  assert.equal(claimed, 'high1');
});

test('claimNextJob vergibt bei gleicher Prioritaet den aeltesten zuerst', async () => {
  freshStore();
  seedJobs([
    { id: 'normal-old', status: 'open', priority: 'normal' },
    { id: 'normal-new', status: 'open', priority: 'normal' },
  ]);
  const claimed = await claimNextJob('worker-a');
  assert.equal(claimed, 'normal-old');
});

test('claimNextJob reserviert in Reihenfolge: hoechste Prio, dann aeltester', async () => {
  freshStore();
  seedJobs([
    { id: 'n1', status: 'open', priority: 'normal' },
    { id: 'h1', status: 'open', priority: 'high' },
    { id: 'n2', status: 'open', priority: 'normal' },
    { id: 'l1', status: 'open', priority: 'low' },
    { id: 'h2', status: 'open', priority: 'high' },
  ]);
  const order = [];
  for (let i = 0; i < 5; i++) order.push(await claimNextJob('worker-a'));
  assert.deepEqual(order, ['h1', 'h2', 'n1', 'n2', 'l1']);
});
