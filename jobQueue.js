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

/**
 * Liest die Store-Datei und gibt die Job-Liste als Array zurueck. Lesefehler, eine
 * kaputte/leere Datei oder ein ungueltiges Format (kein JSON-Array) werden in eine
 * aussagekraeftige Fehlermeldung mit Dateipfad uebersetzt, statt als roher
 * Dateisystem-/Parse-Fehler durchzuschlagen.
 */
async function loadJobs() {
  if (!existsSync(dbPath)) return [];
  let raw;
  try {
    raw = await readFile(dbPath, 'utf-8');
  } catch (err) {
    throw new Error(`Store-Datei "${dbPath}" konnte nicht gelesen werden: ${err.message}`);
  }
  // Simulierte Speicher-Latenz (wie bei einer echten DB-Anfrage ueber das Netzwerk) --
  // macht das Race-Fenster zuverlaessig reproduzierbar statt nur gelegentlich unter Last
  // aufzutreten.
  await new Promise((resolve) => setTimeout(resolve, 15));

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    if (raw.trim() === '') {
      throw new Error(
        `Store-Datei "${dbPath}" ist leer -- der Job-Queue-Speicher ist beschädigt. ` +
          `Bitte mit seedJobs() neu initialisieren.`
      );
    }
    throw new Error(
      `Store-Datei "${dbPath}" enthält kein gültiges JSON: ${err.message}. ` +
        `Bitte Datei prüfen oder mit seedJobs() neu initialisieren.`
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `Store-Datei "${dbPath}" enthält kein JSON-Array (gefunden: ${typeof parsed}). ` +
        `Bitte Datei prüfen oder mit seedJobs() neu initialisieren.`
    );
  }
  return parsed;
}

/**
 * Schreibt die Job-Liste in die Store-Datei. Fehler (z.B. fehlende Schreibrechte, voller
 * Datentraeger) werden mit Dateipfad-Kontext weitergegeben, damit die Ursache nicht im
 * rohen Dateisystem-Fehler untergeht.
 */
async function saveJobs(jobs) {
  try {
    await writeFile(dbPath, JSON.stringify(jobs, null, 2));
  } catch (err) {
    throw new Error(`Store-Datei "${dbPath}" konnte nicht geschrieben werden: ${err.message}`);
  }
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
 * Vergleicht zwei offene Jobs fuer die Vergabe-Reihenfolge in claimNextJob().
 *
 * Die Anforderung ist zweistufig und muss beide Teile gleichzeitig erfuellen:
 *
 *  1. Prioritaet zuerst: Der Job mit der hoechsten Prioritaet (high > normal > low)
 *     wird IMMER vor jedem aelteren Job mit niedrigerer Prioritaet vergeben. Die
 *     Prioritaet hat also Vorrang vor dem Alter.
 *  2. Striktes FIFO innerhalb derselben Prioritaetsklasse: Dort kommt der aelteste
 *     offene Job zuerst -- die Einreihungsreihenfolge (Array-Index) ist das Alter,
 *     da neue Jobs hinten angehaengt und reservierte nie entfernt werden. Die
 *     Prioritaet darf die FIFO-Reihenfolge innerhalb einer Klasse NICHT veraendern.
 *
 * Ergebnis: 'high' vor 'low' (Punkt 1) UND innerhalb z.B. aller 'high'-Jobs strikt
 * aeltester-zuerst (Punkt 2) -- beides gleichzeitig, ohne Kompromiss.
 */
function byPriorityThenFifo(a, b) {
  // Absteigend nach Prioritaet: high(3) > normal(2) > low(1). b - a bringt den
  // hoeheren Rang nach vorn -- 'high' kommt dadurch IMMER vor jedem 'low'-Job.
  const prioDiff = priorityRank(b.job.priority) - priorityRank(a.job.priority);
  if (prioDiff !== 0) return prioDiff;
  // Gleiche Prioritaet: striktes FIFO -- der aeltere Job (kleinerer Array-Index,
  // d.h. frueher eingereiht) wird zuerst vergeben. So bleibt die FIFO-Reihenfolge
  // innerhalb der Prioritaetsklasse vollstaendig erhalten.
  return a.index - b.index;
}

/**
 * Reserviert den naechsten offenen Job fuer workerId. Gibt die Job-ID zurueck, oder null
 * wenn kein offener Job mehr vorhanden ist.
 *
 * Reihenfolge: striktes FIFO innerhalb jeder Prioritaetsklasse -- der aelteste offene
 * Job einer Prioritaet kommt zuerst, und ein Job mit hoher Prioritaet wird trotzdem
 * immer vor einem aelteren Job mit niedriger Prioritaet vergeben (siehe
 * byPriorityThenFifo). Die Prioritaet aendert dabei niemals die FIFO-Reihenfolge
 * innerhalb derselben Prioritaetsklasse.
 *
 * RACE-CONDITION-FIX: Lesen, Reservieren und Schreiben laufen atomar innerhalb von
 * withJobQueueLock(). Der simulierte I/O in loadJobs() (15 ms) liegt damit im
 * kritischen Abschnitt -- zwei gleichzeitige Aufrufe von claimNextJob() koennen den
 * Zustand nicht mehr parallel lesen, bevor einer seine Reservierung geschrieben hat.
 * Die FIFO-Sperre erhaelt die Prioritaets-/Alters-Reihenfolge.
 */
export async function claimNextJob(workerId) {
  // Fehlerbehandlung: Ein Job ohne gueltigen Besitzer ist ein Datenfehler -- sofort und
  // klar ablehnen statt den Job stillschweigend mit einem ungueltigen workerId zu reservieren.
  if (typeof workerId !== 'string' || workerId.trim() === '') {
    throw new TypeError(
      `workerId muss ein nicht-leerer String sein (erhalten: ${JSON.stringify(workerId)}).`
    );
  }
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
      .sort(byPriorityThenFifo)[0];
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
