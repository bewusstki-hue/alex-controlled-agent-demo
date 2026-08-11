import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';

/**
 * Dateibasierter Job-Queue-Speicher (bewusst kein natives SQLite-Modul -- diese Aufgabe
 * laeuft in einer Sandbox ohne Netzwerkzugriff, ein "npm install" waere dort nicht
 * moeglich). Verhalten/Race-Condition-Eigenschaften sind identisch zu einer echten
 * DB-Tabelle mit getrenntem Read+Write ohne Transaktion.
 */

let dbPath = new URL('./jobs.store.json', import.meta.url).pathname;

export function setStorePath(p) {
  dbPath = p;
}

export function seedJobs(jobs) {
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
 * Reserviert den naechsten offenen Job fuer workerId. Gibt die Job-ID zurueck, oder null
 * wenn kein offener Job mehr vorhanden ist.
 *
 * BEKANNTER FEHLER: liest den Zustand, wartet auf I/O, schreibt danach zurueck -- zwei
 * gleichzeitige Aufrufe koennen beide denselben Job als "offen" lesen, bevor einer von
 * beiden seine Reservierung geschrieben hat.
 */
export async function claimNextJob(workerId) {
  const jobs = await loadJobs();
  const next = jobs.find((j) => j.status === 'open');
  if (!next) return null;
  next.status = 'reserved';
  next.workerId = workerId;
  await saveJobs(jobs);
  return next.id;
}

export async function listJobs() {
  return loadJobs();
}
