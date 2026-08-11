# Aufgabe: Race Condition in claimNextJob beheben

Im Repository befindet sich eine kleine Job-Queue (`jobQueue.js`).

Die Funktion `claimNextJob(workerId)` liest zunaechst den naechsten offenen Job und markiert
ihn anschliessend als reserviert. Wenn zwei Worker die Funktion nahezu gleichzeitig aufrufen,
koennen beide denselben Job erhalten.

## Aufgabe

1. Reproduziere den Fehler mit einem automatisierten Test.
2. Aendere die Implementierung so, dass ein Job atomar nur von einem Worker reserviert
   werden kann.
3. Die oeffentliche Funktionssignatur von `claimNextJob(workerId)` darf nicht veraendert
   werden.
4. Fuege einen Test mit mindestens zehn gleichzeitig gestarteten Claim-Versuchen hinzu.
5. Der Test muss beweisen:
   - Jeder Job wird hoechstens einmal vergeben.
   - Nicht erfolgreiche Worker erhalten `null`.
   - Bereits reservierte Jobs werden nicht erneut vergeben.
6. Bestehende Tests (`jobQueue.test.js`) muessen weiterhin funktionieren.
7. Dokumentiere im Pull Request:
   - Ursache des Fehlers,
   - gewaehlte Loesung,
   - ausgefuehrte Tests,
   - verbleibende Risiken.

Veraendere keine Dateien ausserhalb der Jobqueue, ihrer Tests und einer notwendigen kurzen
Dokumentation.

Tests ausfuehren: `npm test` (nutzt Node's eingebauten Testrunner, keine Installation noetig).
