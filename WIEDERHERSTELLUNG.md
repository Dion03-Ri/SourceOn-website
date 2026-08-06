# Wiederherstellungspunkte (Restore Points)

**Kurz:** Es ist alles gespeichert. Jede Änderung ist ein eigener Git-Commit auf dem
Branch `claude/beautiful-bardeen-3xgzwu` (auf GitHub gesichert). Man kann jederzeit
**alles** oder **einzelne** Änderungen zurücksetzen.

## Feste Wiederherstellungspunkte

| Punkt | Commit | Bedeutung |
|-------|--------|-----------|
| **AKTUELL** | `4c3a948` | Alles fertig: Startseiten-Redesign, Provisions-Feature, Nav-Cleanup |
| **VOR REDESIGN** | `0378af7` | Stand direkt **vor** dem visuellen Startseiten-Redesign (Ausgangspunkt) |

(Lokal existieren zusätzlich die Git-Tags `stand-aktuell` und `stand-vor-redesign`.
Der Proxy verbietet das Pushen von Tags, deshalb dienen die Hashes als Referenz.)

## Wie man zurücksetzt

Immer als neuen Commit zurückrollen (dann deployt Vercel automatisch die alte Version):

**Das komplette Startseiten-Redesign rückgängig machen** (zurück auf den Stand davor):
```bash
git revert --no-edit 0378af7..HEAD
git push
```
Oder hart auf den alten Stand setzen (verwirft die neueren Commits im Branch):
```bash
git reset --hard 0378af7
git push --force-with-lease
```

**Nur eine einzelne Änderung** rückgängig machen — Commit in der Liste suchen und:
```bash
git log --oneline        # den passenden Hash finden
git revert --no-edit <hash>
git push
```

**Eine einzelne Datei** auf einen alten Stand bringen:
```bash
git checkout 0378af7 -- index.html
git commit -m "index auf Stand vor Redesign zurueck" && git push
```

## Wichtigste Commits (Design-Arbeit)

- `4c3a948` Nav „Wie es funktioniert" aus der Navigation entfernt
- `700494f` prozess „Der Unterschied" an Seiten-Stil angepasst
- `bfd78fc` Prozess-Strip: nummerierte Schritte
- `e58e775`…`5c7faa6` Hero-Wow (Gold-Headline, Eyebrow, Trust-Zeile) + Feinschliff
- `fdd6f51` **komplettes visuelles Startseiten-Redesign** (Beginn)
- `0378af7` **letzter Stand VOR dem Redesign**

> Du musst dir nichts merken — sag einfach „setz das Redesign zurück" oder
> „mach Änderung X rückgängig", und ich erledige das über die obigen Befehle.
