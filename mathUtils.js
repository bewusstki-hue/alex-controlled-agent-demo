/**
 * clampValue(value, min, max) -- begrenzt einen Zahlenwert auf den Bereich [min, max].
 *
 * DESIGN-ENTSCHEIDUNGEN UND RANDFAELLE:
 *
 * 1. Inklusive Grenzen: Der Rueckgabewert liegt immer innerhalb des abgeschlossenen
 *    Intervalls [min, max], d.h. ein Wert exakt auf einer Grenze (value === min oder
 *    value === max) wird unveraendert zurueckgegeben. Das ist das konventionelle
 *    Verhalten von clamp() in den meisten Sprachen und erwartbarer als ein halboffenes
 *    Intervall, das den Maximalwert kappen wuerde.
 *
 * 2. Fehler statt stillem Korrigieren: Wenn min > max ist, existiert kein sinnvolles
 *    Intervall, auf das begrenzt werden koennte. Statt stillschweigend die Grenzen zu
 *    tauschen (was ein versteckter Bug im Aufrufer waere) wird ein Error geworfen. Ein
 *    stilles Tauschen wuerde unerwartetes Verhalten erzeugen und das eigentliche Problem
 *    verschleiern.
 *
 * 3. NaN-Handling: NaN ist keine echte Zahl und mit allen Vergleichen (auch
 *    value >= min) immer false, sodass das Ergebnis ohne explizite Pruefung je nach
 *    Eingabe unvorhersehbar waere (z.B. wuerde NaN < min fehlschlagen und der Wert
 *    durchrutschen). Deshalb werden alle drei Argumente explizit auf NaN geprueft und
 *    ein Error geworfen statt eine leere oder falsche Grenze zurueckzugeben.
 *
 * 4. Typpruefung auf number: Nur Zahlen (inkl. negativer, Dezimal- und Infinity-Werte)
 *    sind als Argumente sinnvoll. Strings oder andere Typen koennten durch die
 *    relationalen Vergleiche implizit konvertiert werden ("10" < 20 ist true), was
 *    subtile Bugs verursacht. Daher wird zusaetzlich mit typeof geprueft.
 *
 * 5. Infinity als Grenzen: +/-Infinity werden bewusst NICHT als Fehler behandelt, da sie
 *    mathematisch wohldefinierte Grenzen darstellen (clampValue(x, -Infinity, Infinity)
 *    gibt x unveraendert zurueck). Nur NaN ist als Grenze ungueltig.
 *
 * @param {number} value Der zu begrenzende Wert.
 * @param {number} min Untere Grenze (inklusive).
 * @param {number} max Obere Grenze (inklusive).
 * @returns {number} value begrenzt auf das Intervall [min, max].
 * @throws {TypeError} Wenn value, min oder max keine Zahl sind (oder NaN).
 * @throws {RangeError} Wenn min > max ist.
 */
export function clampValue(value, min, max) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new TypeError(`clampValue: value muss eine Zahl sein, erhalten: ${String(value)}`);
  }
  if (typeof min !== 'number' || Number.isNaN(min)) {
    throw new TypeError(`clampValue: min muss eine Zahl sein, erhalten: ${String(min)}`);
  }
  if (typeof max !== 'number' || Number.isNaN(max)) {
    throw new TypeError(`clampValue: max muss eine Zahl sein, erhalten: ${String(max)}`);
  }
  if (min > max) {
    throw new RangeError(`clampValue: min (${min}) darf nicht groesser als max (${max}) sein`);
  }
  return Math.min(Math.max(value, min), max);
}

/**
 * clampPercentage(value) -- begrenzt einen Wert auf den Prozentbereich [0, 100].
 *
 * Konvenienzfunktion auf Basis von clampValue: delegiert die gesamte Logik
 * (inkl. Grenzpruefung, NaN- und Typpruefung sowie die Fehler bei min > max)
 * an clampValue(value, 0, 100). Ein Wert unter 0 wird auf 0 gekappt, ein Wert
 * ueber 100 auf 100, Werte dazwischen bleiben unveraendert.
 *
 * @param {number} value Der zu begrenzende Wert.
 * @returns {number} value begrenzt auf das Intervall [0, 100].
 * @throws {TypeError} Wenn value keine Zahl ist (oder NaN) -- von clampValue.
 */
export function clampPercentage(value) {
  return clampValue(value, 0, 100);
}
