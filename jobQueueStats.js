import { listJobs } from './jobQueue.js';

/** Deterministische Ausgabe-Reihenfolge der Prioritaeten. */
const PRIORITIES = ['high', 'normal', 'low'];

/**
 * Zaehlt pro Prioritaet, wie viele Jobs offen bzw. reserviert sind.
 *
 * Rueckgabe, z.B.:
 * {
 *   high:   { open: 1, reserved: 0 },
 *   normal: { open: 0, reserved: 2 },
 *   low:    { open: 1, reserved: 1 }
 * }
 *
 * Jobs ohne priority-Feld werden als 'normal' gezaehlt; andere Status als
 * open/reserved (z.B. 'done') gehen nicht in die Zaehlung ein.
 */
export async function countJobsByPriority() {
  const jobs = await listJobs();
  const result = {};
  for (const p of PRIORITIES) {
    result[p] = { open: 0, reserved: 0 };
  }
  for (const job of jobs) {
    const priority = job.priority ?? 'normal';
    const bucket = result[priority] ?? result.normal;
    if (job.status === 'open' || job.status === 'reserved') {
      bucket[job.status]++;
    }
  }
  return result;
}
