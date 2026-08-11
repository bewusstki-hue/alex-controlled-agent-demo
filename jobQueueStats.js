import { PRIORITIES, normalizePriority } from './jobQueue.js';

/**
 * Zaehlt fuer jede Prioritaet getrennt, wie viele Jobs den Status 'open' bzw. 'reserved'
 * haben. Jobs ohne Prioritaetsangabe gelten als 'normal'. Ungueltige Prioritaeten werden
 * abgelehnt (wirft einen Fehler). Andere Stati (weder open noch reserved) werden ignoriert.
 *
 * Rueckgabe: { high: { open, reserved }, normal: { open, reserved }, low: { open, reserved } }
 */
export function getPriorityStats(jobs) {
  const stats = {};
  for (const priority of PRIORITIES) {
    stats[priority] = { open: 0, reserved: 0 };
  }
  for (const job of jobs) {
    const priority = normalizePriority(job.priority);
    if (job.status === 'open') {
      stats[priority].open += 1;
    } else if (job.status === 'reserved') {
      stats[priority].reserved += 1;
    }
  }
  return stats;
}
