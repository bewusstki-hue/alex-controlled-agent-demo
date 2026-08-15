import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';

/**
 * Dateibasierter Job-Queue-Speicher (bewusst kein natives SQLite-Modul -- diese Aufgabe
 * laeuft in einer Sandbox ohne Netzwerkzugriff, ein "npm install" waere dort nicht
 * moeglich). Verhalten/Race-Condition-Eigenschaften sind identisch zu einer echten
 * DB-Tabelle mit getrenntem Read+Write ohne Transaktion.
 */

let dbPath = new URL('./jobs.store.json', import.meta.url).pathname;

/**
 * In-Prozess-Mutex auf Basis einer Promise-Kette. Serialisiert den kritischen Abschnitt
 * (Lesen + Reservieren + Schreiben) von claimNextJob(), damit zwei gleichzeitige Aufrufe
 * nicht beide denselben offenen Job als "offen" lesen koennen. Die Warteschlange ist FIFO:
 * Jeder neue Aufrufer haengt sich hinten an die Kette an -- dadurch bleibt die
 * Prioritaets-/FIFO-Reihenfolge erhalten und es gibt weder Deadlock noch Starvation.
 */
let lockChain = Promise.resolve();

async function withJobQueueLock(fn) {
  // Aktuelle Kette abwarten und gleichzeitig die neue "Sperre" fuer den naechsten
  // Aufrufer registrieren. release() wird genau einmal aufgerufen (finally) --
  // kein Deadlock, auch wenn fn wirft.
  const prev = lockChain;
  let release;
  lockChain = new Promise((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

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

/** Rangordnung der Prioritaeten: high > normal > low. Jobs ohne Feld gelten als 'normal'. */
const PRIORITY_RANK = { high: 3, normal: 2, low: 1 };

export function priorityRank(priority) {
  return PRIORITY_RANK[priority] ?? PRIORITY_RANK.normal;
}

/**
 * Prueft, ob ein priority-Wert gueltig ist. Erlaubt sind ausschliesslich 'high',
 * 'normal' und 'low' sowie undefined/null (gelten als 'normal').
 */
export function isValidPriority(priority) {
  return priority == null || PRIORITY_RANK[priority] !== undefined;
}

/**
 * Reserviert den naechsten offenen Job fuer workerId. Gibt die Job-ID zurueck, oder null
 * wenn kein offener Job mehr vorhanden ist.
 *
 * Reihenfolge: zuerst der Job mit der hoechsten Prioritaet (high > normal > low), bei
 * gleicher Prioritaet der aelteste -- die Einreihungsreihenfolge (Array-Index) ist das
 * Alter eines Jobs, da neue Jobs hinten angehaengt werden und reservierte nie entfernt
 * werden.
 *
 * RACE-CONDITION-FIX: Lesen, Reservieren und Schreiben laufen atomar innerhalb von
 * withJobQueueLock(). Der simulierte I/O in loadJobs() (15 ms) liegt damit im
 * kritischen Abschnitt -- zwei gleichzeitige Aufrufe von claimNextJob() koennen den
 * Zustand nicht mehr parallel lesen, bevor einer seine Reservierung geschrieben hat.
 * Die FIFO-Sperre erhaelt die Prioritaets-/Alters-Reihenfolge.
 */
export async function claimNextJob(workerId) {
  return withJobQueueLock(async () => {
    const jobs = await loadJobs();

    // Validierung: Ein offener Job mit ungueltigem priority-Wert ist ein Datenfehler und
    // wird nicht stillschweigend wie 'normal' behandelt, sondern mit einem Fehler abgelehnt.
    const invalid = jobs.find((job) => job.status === 'open' && !isValidPriority(job.priority));
    if (invalid) {
      throw new Error(
        `Ungültiger priority-Wert ${JSON.stringify(invalid.priority)} bei Job "${invalid.id}". ` +
          `Erlaubt sind 'high', 'normal', 'low' oder ein fehlender Wert (= 'normal').`
      );
    }

    const next = jobs
      .map((job, index) => ({ job, index }))
      .filter(({ job }) => job.status === 'open')
      .sort((a, b) => {
        const prioDiff = priorityRank(b.job.priority) - priorityRank(a.job.priority);
        if (prioDiff !== 0) return prioDiff;
        return a.index - b.index; // gleiche Prioritaet: aelterer Job zuerst
      })[0];
    if (!next) return null;
    next.job.status = 'reserved';
    next.job.workerId = workerId;
    await saveJobs(jobs);
    return next.job.id;
  });
}

export async function listJobs() {
  return loadJobs();
}
