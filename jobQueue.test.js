import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { claimNextJob, listJobs, normalizePriority, seedJobs, setStorePath } from './jobQueue.js';
import { getPriorityStats } from './jobQueueStats.js';

function freshStore() {
  const dir = mkdtempSync(path.join(tmpdir(), 'jobqueue-test-'));
  setStorePath(path.join(dir, 'jobs.json'));
  return path.join(dir, 'jobs.json');
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

test('claimNextJob reserviert zuerst den Job mit hoechster Prioritaet', async () => {
  freshStore();
  seedJobs([
    { id: 'low1', status: 'open', priority: 'low' },
    { id: 'normal1', status: 'open', priority: 'normal' },
    { id: 'high1', status: 'open', priority: 'high' },
  ]);
  assert.equal(await claimNextJob('w1'), 'high1');
  assert.equal(await claimNextJob('w1'), 'normal1');
  assert.equal(await claimNextJob('w1'), 'low1');
});

test('claimNextJob respektiert FIFO bei gleicher Prioritaet', async () => {
  freshStore();
  seedJobs([
    { id: 'h-old', status: 'open', priority: 'high' },
    { id: 'h-new', status: 'open', priority: 'high' },
    { id: 'l-old', status: 'open', priority: 'low' },
  ]);
  assert.equal(await claimNextJob('w1'), 'h-old');
  assert.equal(await claimNextJob('w1'), 'h-new');
  assert.equal(await claimNextJob('w1'), 'l-old');
});

test('Jobs ohne Prioritaet gelten als normal', async () => {
  freshStore();
  seedJobs([
    { id: 'no-prio', status: 'open' },
    { id: 'explicit-low', status: 'open', priority: 'low' },
    { id: 'explicit-normal', status: 'open', priority: 'normal' },
  ]);
  // no-prio (normal) und explicit-normal sind beide normal -> FIFO: no-prio zuerst.
  assert.equal(await claimNextJob('w1'), 'no-prio');
  assert.equal(await claimNextJob('w1'), 'explicit-normal');
  assert.equal(await claimNextJob('w1'), 'explicit-low');
  // normalizePriority liefert fuer fehlende Angabe 'normal'.
  assert.equal(normalizePriority(undefined), 'normal');
  assert.equal(normalizePriority(null), 'normal');
});

test('ungueltige Prioritaeten werden abgelehnt', async () => {
  freshStore();
  // seedJobs lehnt ungueltige Prioritaeten beim Einfuegen ab.
  assert.throws(() => seedJobs([{ id: 'bad', status: 'open', priority: 'urgent' }]), /ungueltige Prioritaet/i);
  assert.throws(() => seedJobs([{ id: 'bad', status: 'open', priority: 42 }]), /ungueltige Prioritaet/i);
  // normalizePriority lehnt ungueltige Werte ab.
  assert.throws(() => normalizePriority('urgent'), /ungueltige Prioritaet/i);
  assert.throws(() => normalizePriority(''), /ungueltige Prioritaet/i);
  // claimNextJob lehnt offene Jobs mit ungueltiger Prioritaet ab (Direktzugriff auf den Store).
  const storePath = freshStore();
  writeFileSync(storePath, JSON.stringify([
    { id: 'bad-open', status: 'open', priority: 'urgent' },
    { id: 'good', status: 'open', priority: 'high' },
  ]));
  await assert.rejects(() => claimNextJob('w1'), /ungueltige Prioritaet/i);
});

test('getPriorityStats zaehlt open und reserved je Prioritaet', async () => {
  freshStore();
  seedJobs([
    { id: 'h1', status: 'open', priority: 'high' },
    { id: 'h2', status: 'reserved', priority: 'high' },
    { id: 'n1', status: 'open' }, // fehlende Angabe => normal
    { id: 'n2', status: 'reserved', priority: 'normal' },
    { id: 'l1', status: 'open', priority: 'low' },
    { id: 'done', status: 'done', priority: 'high' }, // ignoriert
  ]);
  assert.deepEqual(getPriorityStats(await listJobs()), {
    high: { open: 1, reserved: 1 },
    normal: { open: 1, reserved: 1 },
    low: { open: 1, reserved: 0 },
  });
});
