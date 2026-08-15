import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
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

test('claimNextJob akzeptiert alle gueltigen Prioritaeten weiterhin korrekt', async () => {
  freshStore();
  seedJobs([
    { id: 'l1', status: 'open', priority: 'low' },
    { id: 'h1', status: 'open', priority: 'high' },
    { id: 'n1', status: 'open', priority: 'normal' },
  ]);
  const order = [];
  for (let i = 0; i < 3; i++) order.push(await claimNextJob('worker-a'));
  assert.deepEqual(order, ['h1', 'n1', 'l1']);
});

test('claimNextJob behandelt fehlenden priority-Wert weiterhin als normal', async () => {
  freshStore();
  seedJobs([
    { id: 'no-prio', status: 'open' },
    { id: 'low1', status: 'open', priority: 'low' },
  ]);
  const claimed = await claimNextJob('worker-a');
  assert.equal(claimed, 'no-prio');
});

test('claimNextJob wirft einen Fehler bei ungueltigem priority-Wert eines offenen Jobs', async () => {
  freshStore();
  seedJobs([
    { id: 'ok', status: 'open', priority: 'high' },
    { id: 'bad', status: 'open', priority: 'urgent' },
  ]);
  await assert.rejects(() => claimNextJob('worker-a'), /Ungültiger priority-Wert "urgent"/);
});

test('claimNextJob ignoriert ungueltige Prioritaet bei nicht-offenen Jobs', async () => {
  freshStore();
  seedJobs([{ id: 'bad', status: 'reserved', priority: 'urgent' }]);
  const claimed = await claimNextJob('worker-a');
  assert.equal(claimed, null);
});

test('claimNextJob vergibt keinen Job doppelt bei gleichzeitigen Aufrufen (Race-Condition-Fix)', async () => {
  freshStore();
  seedJobs([
    { id: 'j1', status: 'open', priority: 'high' },
    { id: 'j2', status: 'open', priority: 'normal' },
    { id: 'j3', status: 'open', priority: 'normal' },
    { id: 'j4', status: 'open', priority: 'low' },
  ]);

  // 6 parallele Aufrufe fuer 4 offene Jobs: Es duerfen exakt die 4 Jobs vergeben werden,
  // die uebrigen 2 Aufrufe muessen null zurueckbekommen. Ohne den Fix haette sich das
  // simulierte 15ms-I/O-Fenster ueberlagert und ein Job waere doppelt reserviert worden.
  const workers = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'];
  const results = await Promise.all(workers.map((w) => claimNextJob(w)));

  const claimed = results.filter((r) => r !== null);
  const nulls = results.filter((r) => r === null);

  // Jeder verfuegbare Job wird hoechstens einmal vergeben und genau die 4 offenen Jobs
  // werden vergeben -- keine Duplikate, keine verlorenen Jobs.
  assert.equal(new Set(claimed).size, claimed.length, 'kein Job darf doppelt vergeben werden');
  assert.deepEqual([...new Set(claimed)].sort(), ['j1', 'j2', 'j3', 'j4']);
  assert.equal(nulls.length, 2);

  // Die Reservierungen sind auch persistent: jeder vergebene Job ist genau einmal
  // reserved, die restlichen zwei Aufrufe haben nichts reserviert.
  const jobs = await listJobs();
  const reserved = jobs.filter((j) => j.status === 'reserved');
  assert.equal(reserved.length, 4);
  assert.equal(new Set(reserved.map((j) => j.workerId)).size, 4);
});

// --- Neue Fehlerpfade aus PR #10 ---

// Schreibt den Store-Pfad auf ein frisches tmp-Verzeichnis und legt die Store-Datei
// direkt mit rohem Inhalt an (statt ueber seedJobs), um kaputte/leere Dateien zu testen.
function writeStore(rawContent) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jobqueue-test-'));
  const storePath = path.join(dir, 'jobs.json');
  setStorePath(storePath);
  writeFileSync(storePath, rawContent);
}

test('loadJobs wirft einen Fehler bei leerer Store-Datei', async () => {
  writeStore('');
  await assert.rejects(() => listJobs(), /ist leer/);
});

test('loadJobs wirft einen Fehler bei kaputter Store-Datei (kein gueltiges JSON)', async () => {
  writeStore('das ist kein json {{');
  await assert.rejects(() => listJobs(), /kein gültiges JSON/);
});

test('loadJobs wirft einen Fehler bei gueltigem JSON, das kein Array ist', async () => {
  writeStore('{"status": "kein array"}');
  await assert.rejects(() => listJobs(), /kein JSON-Array/);
});

test('claimNextJob wirft TypeError bei nicht-String workerId', async () => {
  freshStore();
  await assert.rejects(() => claimNextJob(123), TypeError);
  await assert.rejects(() => claimNextJob(123), /muss ein nicht-leerer String sein/);
  await assert.rejects(() => claimNextJob(null), TypeError);
});

test('claimNextJob wirft TypeError bei leerer oder Whitespace-workerId', async () => {
  freshStore();
  await assert.rejects(() => claimNextJob(''), TypeError);
  await assert.rejects(() => claimNextJob('   '), TypeError);
  await assert.rejects(() => claimNextJob(''), /muss ein nicht-leerer String sein/);
});
