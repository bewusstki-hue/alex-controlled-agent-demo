import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  claimNextJob,
  getStats,
  listJobs,
  reclaimExpiredJobs,
  seedJobs,
  setClock,
  setLeaseDuration,
  setStorePath,
} from './jobQueue.js';

function freshStore() {
  const dir = mkdtempSync(path.join(tmpdir(), 'jobqueue-test-'));
  setStorePath(path.join(dir, 'jobs.json'));
  // Ruecksetzen der globalen Konfiguration, damit Tests unabhaengig voneinander sind.
  setLeaseDuration(30000);
  setClock(() => Date.now());
}

// --- Bisherige Tests (muessen weiterhin funktionieren) -------------------------

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

// --- Zeitlich begrenzte Reservierungen (Leases) --------------------------------

test('claimNextJob setzt reservedAt und leaseExpiresAt mit Standard-Lease von 30s', async () => {
  freshStore();
  setClock(() => 1000);
  seedJobs([{ id: 'j1', status: 'open' }]);
  await claimNextJob('worker-a');
  const job = (await listJobs()).find((j) => j.id === 'j1');
  assert.equal(job.reservedAt, 1000);
  assert.equal(job.leaseExpiresAt, 1000 + 30000);
});

test('Lease-Dauer ist bei der Erstellung der Queue konfigurierbar', async () => {
  freshStore();
  setLeaseDuration(5000);
  setClock(() => 2000);
  seedJobs([{ id: 'j1', status: 'open' }]);
  await claimNextJob('worker-a');
  const job = (await listJobs()).find((j) => j.id === 'j1');
  assert.equal(job.reservedAt, 2000);
  assert.equal(job.leaseExpiresAt, 2000 + 5000);
});

// --- reclaimExpiredJobs --------------------------------------------------------

test('reclaimExpiredJobs laesst noch gueltige Leases unangetastet', async () => {
  freshStore();
  seedJobs([{ id: 'j1', status: 'reserved', workerId: 'w', reservedAt: 100, leaseExpiresAt: 1000 }]);
  const reclaimed = await reclaimExpiredJobs(999); // Lease laeuft erst bei 1000 ab
  assert.equal(reclaimed, 0);
  const job = (await listJobs()).find((j) => j.id === 'j1');
  assert.equal(job.status, 'reserved');
  assert.equal(job.workerId, 'w');
  assert.equal(job.reservedAt, 100);
  assert.equal(job.leaseExpiresAt, 1000);
});

test('reclaimExpiredJobs gibt exakt abgelaufene Leases frei (leaseExpiresAt === now)', async () => {
  freshStore();
  seedJobs([{ id: 'j1', status: 'reserved', workerId: 'w', reservedAt: 100, leaseExpiresAt: 1000 }]);
  const reclaimed = await reclaimExpiredJobs(1000); // exakt abgelaufen
  assert.equal(reclaimed, 1);
  const job = (await listJobs()).find((j) => j.id === 'j1');
  assert.equal(job.status, 'open');
  assert.equal(job.workerId, undefined);
  assert.equal(job.reservedAt, undefined);
  assert.equal(job.leaseExpiresAt, undefined);
});

test('reclaimExpiredJobs gibt bereits laenger abgelaufene Leases frei', async () => {
  freshStore();
  seedJobs([{ id: 'j1', status: 'reserved', workerId: 'w', reservedAt: 100, leaseExpiresAt: 1000 }]);
  const reclaimed = await reclaimExpiredJobs(5000); // laengst abgelaufen
  assert.equal(reclaimed, 1);
  const job = (await listJobs()).find((j) => j.id === 'j1');
  assert.equal(job.status, 'open');
  assert.equal(job.workerId, undefined);
  assert.equal(job.reservedAt, undefined);
  assert.equal(job.leaseExpiresAt, undefined);
});

test('reclaimExpiredJobs beruehrt offene Jobs nicht', async () => {
  freshStore();
  seedJobs([
    { id: 'j1', status: 'open', priority: 'high' },
    { id: 'j2', status: 'reserved', workerId: 'w', reservedAt: 100, leaseExpiresAt: 1000 },
  ]);
  const reclaimed = await reclaimExpiredJobs(5000);
  assert.equal(reclaimed, 1); // nur der abgelaufene reservierte Job
  const jobs = await listJobs();
  const open = jobs.find((j) => j.id === 'j1');
  assert.equal(open.status, 'open');
  assert.equal(open.priority, 'high');
  assert.equal(open.reservedAt, undefined);
  assert.equal(open.leaseExpiresAt, undefined);
});

test('reclaimExpiredJobs ist idempotent bei wiederholtem Aufruf mit demselben Zeitpunkt', async () => {
  freshStore();
  seedJobs([{ id: 'j1', status: 'reserved', workerId: 'w', reservedAt: 100, leaseExpiresAt: 1000 }]);
  const first = await reclaimExpiredJobs(1000);
  assert.equal(first, 1);
  const afterFirst = await listJobs();

  const second = await reclaimExpiredJobs(1000); // gleicher Zeitpunkt
  assert.equal(second, 0); // keine zusaetzliche Freigabe

  const afterSecond = await listJobs();
  assert.deepEqual(afterSecond, afterFirst); // kein zusaetzlicher Zustandsaenderung
});

test('reclaimExpiredJobs erhaelt die FIFO-Reihenfolge (zurueckgegebener Job vor spaeter eingestellten)', async () => {
  freshStore();
  seedJobs([
    { id: 'alt', status: 'reserved', workerId: 'w', reservedAt: 100, leaseExpiresAt: 1000 },
    { id: 'spaeter', status: 'open' },
  ]);
  await reclaimExpiredJobs(2000); // 'alt' wird wieder freigegeben (bleibt an Position 0)
  const claimed = await claimNextJob('worker-x');
  assert.equal(claimed, 'alt'); // wieder freigegebener Job wird vor dem spaeteren beansprucht
});

test('reclaimExpiredJobs erhaelt die Prioritaet (gleiche Prioritaet, FIFO erhalten)', async () => {
  freshStore();
  seedJobs([
    // Array ist nach Prioritaet + Einfuegereihenfolge sortiert (high zuerst).
    { id: 'h-abgelaufen', priority: 'high', status: 'reserved', workerId: 'w', reservedAt: 100, leaseExpiresAt: 1000 },
    { id: 'h-offen', priority: 'high', status: 'open' },
    { id: 'l-offen', priority: 'low', status: 'open' },
  ]);
  await reclaimExpiredJobs(2000);
  // Der zurueckgegebene high-Job hat dieselbe Prioritaet wie der spaeter eingestellte
  // high-Job, wurde aber frueher eingefuegt -> wird zuerst beansprucht.
  const first = await claimNextJob('worker-1');
  assert.equal(first, 'h-abgelaufen');
  const second = await claimNextJob('worker-2');
  assert.equal(second, 'h-offen'); // naechster mit gleicher Prioritaet
  const third = await claimNextJob('worker-3');
  assert.equal(third, 'l-offen'); // erst dann die niedrigere Prioritaet
});

test('reclaimExpiredJobs aktualisiert die Queue-Statistik', async () => {
  freshStore();
  seedJobs([
    { id: 'j1', status: 'open' },
    { id: 'j2', status: 'reserved', workerId: 'w', reservedAt: 100, leaseExpiresAt: 1000 },
  ]);
  const before = await getStats();
  assert.deepEqual(before, { total: 2, open: 1, reserved: 1 });

  await reclaimExpiredJobs(1000);

  const after = await getStats();
  assert.deepEqual(after, { total: 2, open: 2, reserved: 0 });
});
