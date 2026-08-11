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
