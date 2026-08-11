import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';

/**
 * Dateibasierter Job-Queue-Speicher (bewusst kein natives SQLite-Modul -- diese Aufgabe
 * laeuft in einer Sandbox ohne Netzwerkzugriff, ein "npm install" waere dort nicht
 * moeglich). Verhalten/Race-Condition-Eigenschaften sind identisch zu einer echten
 * DB-Tabelle mit getrenntem Read+Write ohne Transaktion.
 */

let dbPath = new URL('./jobs.store.json', import.meta.url).pathname;

// Lease-Konfiguration: Dauer standardmaessig 30 Sekunden (in Millisekunden).
// Die Uhr ist injizierbar, damit Tests ohne echte Wartezeiten mit expliziten
// Zeitwerten arbeiten koennen.
let leaseDurationMs = 30000;
let nowFn = () => Date.now();

export function setStorePath(p) {
  dbPath = p;
}

/**
 * Konfiguriert die Lease-Dauer in Millisekunden (bei der Erstellung/Initialisierung der
 * Queue). Wird beim Reservieren eines Jobs (claimNextJob) verwendet, um leaseExpiresAt
 * zu berechnen. Standard: 30000 ms (30 Sekunden).
 */
export function setLeaseDuration(ms) {
  leaseDurationMs = ms;
}

/**
 * Injiziert eine Uhr-Funktion, die die aktuelle Zeit in Millisekunden liefert.
 * Nur fuer Tests gedacht, um deterministisch zu arbeiten (keine echten Wartezeiten).
 */
export function setClock(fn) {
  nowFn = fn;
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
 * Der reservierte Job erhaelt zusaetzlich reservedAt (Zeitpunkt der Reservierung) und
 * leaseExpiresAt (= reservedAt + konfigurierte Lease-Dauer). Dadurch ist die Reservierung
 * zeitlich begrenzt: Ist die Lease abgelaufen, kann der Job ueber reclaimExpiredJobs
 * wieder freigegeben werden.
 *
 * BEKANNTER FEHLER (unveraendert, nicht Teil dieser Aufgabe): liest den Zustand, wartet
 * auf I/O, schreibt danach zurueck -- zwei gleichzeitige Aufrufe koennen beide denselben
 * Job als "offen" lesen, bevor einer von beiden seine Reservierung geschrieben hat.
 */
export async function claimNextJob(workerId) {
  const jobs = await loadJobs();
  const next = jobs.find((j) => j.status === 'open');
  if (!next) return null;
  const now = nowFn();
  next.status = 'reserved';
  next.workerId = workerId;
  next.reservedAt = now;
  next.leaseExpiresAt = now + leaseDurationMs;
  await saveJobs(jobs);
  return next.id;
}

/**
 * Gibt ausschliesslich reservierte Jobs frei, deren Lease abgelaufen ist
 * (leaseExpiresAt kleiner oder gleich `now`). Freigegebene Jobs wechseln zurueck auf
 * 'open'; workerId, reservedAt und leaseExpiresAt werden entfernt.
 *
 * Prioritaet und urspruengliche Einfuegereihenfolge bleiben erhalten: Der Job bleibt an
 * seiner urspruenglichen Position im Array und wird daher bei gleicher Prioritaet
 * weiterhin VOR spaeter eingestellten Jobs beansprucht.
 *
 * Idempotent: Wenn nichts freigegeben wurde, wird nicht geschrieben. Ein wiederholter
 * Aufruf mit demselben Zeitpunkt verursacht deshalb keine zusaetzlichen Aenderungen.
 *
 * Gibt die Anzahl der freigegebenen Jobs zurueck.
 */
export async function reclaimExpiredJobs(now) {
  const jobs = await loadJobs();
  let reclaimed = 0;
  for (const job of jobs) {
    if (
      job.status === 'reserved' &&
      typeof job.leaseExpiresAt === 'number' &&
      job.leaseExpiresAt <= now
    ) {
      job.status = 'open';
      delete job.workerId;
      delete job.reservedAt;
      delete job.leaseExpiresAt;
      reclaimed += 1;
    }
  }
  if (reclaimed > 0) {
    await saveJobs(jobs);
  }
  return reclaimed;
}

export async function listJobs() {
  return loadJobs();
}

/**
 * Liefert die aktuelle Queue-Statistik (Gesamtzahl sowie Anzahl offener und reservierter
 * Jobs). Sie spiegelt den tatsaechlichen Zustand der Queue wider und wird dadurch durch
 * claimNextJob (reserviert) und reclaimExpiredJobs (freigegeben) automatisch aktuell
 * gehalten.
 */
export async function getStats() {
  const jobs = await loadJobs();
  const stats = { total: jobs.length, open: 0, reserved: 0 };
  for (const job of jobs) {
    if (job.status === 'open') stats.open += 1;
    else if (job.status === 'reserved') stats.reserved += 1;
  }
  return stats;
}
