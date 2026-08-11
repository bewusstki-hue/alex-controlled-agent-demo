import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';

/**
 * Dateibasierter Job-Queue-Speicher (bewusst kein natives SQLite-Modul -- diese Aufgabe
 * laeuft in einer Sandbox ohne Netzwerkzugriff, ein "npm install" waere dort nicht
 * moeglich). Verhalten/Race-Condition-Eigenschaften sind identisch zu einer echten
 * DB-Tabelle mit getrenntem Read+Write ohne Transaktion.
 */

let dbPath = new URL('./jobs.store.json', import.meta.url).pathname;

/** Erlaubte Prioritaeten, sortiert von hoechster zu niedrigster Prioritaet. */
export const PRIORITIES = ['high', 'normal', 'low'];

const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };
const DEFAULT_PRIORITY = 'normal';

export function setStorePath(p) {
  dbPath = p;
}

/**
 * Normalisiert die Prioritaet eines Jobs. Jobs ohne Prioritaetsangabe gelten als 'normal'.
 * Ungueltige Prioritaeten werden abgelehnt (wirft einen Fehler).
 */
export function normalizePriority(priority) {
  if (priority === undefined || priority === null) return DEFAULT_PRIORITY;
  if (!(priority in PRIORITY_RANK)) {
    throw new Error(
      `Ungueltige Prioritaet: ${JSON.stringify(priority)} (erlaubt: ${PRIORITIES.join(', ')})`,
    );
  }
  return priority;
}

export function seedJobs(jobs) {
  // Ungueltige Prioritaeten schon beim Einfuegen ablehnen.
  for (const job of jobs) {
    normalizePriority(job.priority);
  }
  writeFileSync(dbPath, JSON.stringify(jobs, null, 2));
}

async function loadJobs() {
  if (!existsSync(dbPath)) return [];
  const raw = await readFile(dbPath, 'utf-8');
  // Simulierte Speicher-Latenz (wie bei einer echten DB-Anfrage ueber das Netzwerk) --
  // macht das Race-Fenster zuverlaessig reproduzierbar statt nur gelegentlich unter Last
  // aufzutreten.
  await new Promise((resolve) => setTimeout(resolve, 15));
  return JSON.parse(raw);
}

async function saveJobs(jobs) {
  await writeFile(dbPath, JSON.stringify(jobs, null, 2));
}

/**
 * Reserviert fuer workerId den aeltesten offenen Job der hoechsten verfuegbaren
 * Prioritaet (high > normal > low). Bei gleicher Prioritaet gilt FIFO (Reihenfolge
 * im Store = Einfuege-Reihenfolge). Gibt die Job-ID zurueck, oder null wenn kein
 * offener Job mehr vorhanden ist. Offene Jobs mit ungueltiger Prioritaet werden
 * abgelehnt (wirft einen Fehler).
 *
 * BEKANNTER FEHLER: liest den Zustand, wartet auf I/O, schreibt danach zurueck -- zwei
 * gleichzeitige Aufrufe koennen beide denselben Job als "offen" lesen, bevor einer von
 * beiden seine Reservierung geschrieben hat.
 */
export async function claimNextJob(workerId) {
  const jobs = await loadJobs();
  let best = null;
  let bestRank = Infinity;
  // In Store-Reihenfolge (aelteste zuerst) iterieren; nur bei echt hoeherer Prioritaet
  // wechseln, dadurch bleibt innerhalb derselben Prioritaet FIFO erhalten.
  for (const job of jobs) {
    if (job.status !== 'open') continue;
    const rank = PRIORITY_RANK[normalizePriority(job.priority)];
    if (rank < bestRank) {
      best = job;
      bestRank = rank;
    }
  }
  if (!best) return null;
  best.status = 'reserved';
  best.workerId = workerId;
  await saveJobs(jobs);
  return best.id;
}

export async function listJobs() {
  return loadJobs();
}
