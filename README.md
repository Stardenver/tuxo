# T.U.X.O.

Ein Höhlenabenteuer im 8-Bit-Stil, frei nach dem C64-Klassiker H.E.R.O.: Tux fliegt mit dem Jetpack
durch Höhlen, sprengt Wände, Türen und Monster mit Dynamit und rettet Pinguin-Küken.

Läuft als statische Seite im Browser; zum Teilen eigener Level und für die globale Bestenliste gehört eine
kleine API dazu.

## Steuerung

| Taste | Aktion |
|---|---|
| Pfeil links / rechts oder A / D | laufen |
| Leertaste (oder Pfeil hoch / W) | Jetpack – je länger gedrückt, desto höher; mit dem richtigen Rhythmus kann man schweben. Das Jetpack verbraucht Treibstoff (Anzeige TANK); ist er leer, kann Tux nur noch springen |
| Pfeil runter oder S | ducken (am Boden), weicht Lasern und Äxten aus |
| E | Dynamit ablegen (explodiert nach 2 Sekunden) |
| P / Esc | Pause |
| M | Ton an/aus |

Auf Touch-Geräten erscheinen Bildschirmknöpfe.

## Punkte und Bestenliste

Punkte gibt es für Monster, Wände, Edelsteine und am Levelende für übrige Energie, übrigen Treibstoff und übriges Dynamit. Energie kostet nur ein tiefer Fall
(ab etwa 6 Kacheln); wer mit dem Jetpack abbremst, bleibt unverletzt.
Dazu kommt ein **Zeitbonus**: Jedes Level hat eine Sollzeit (0,8 Sekunden pro Spalte), jede Sekunde
darunter bringt 20 Punkte. Die Uhr läuft oben im Bild und wird rot, sobald die Sollzeit vorbei ist.

Nach dem Game Over erscheint die **Bestenliste** mit den zehn besten Spielern, wie am Automaten.
Wer genug Punkte für die Liste hat, gibt seinen Namen ein (bis zu 10 Zeichen: A–Z, ÄÖÜ, 0–9, Leerzeichen
und `.-!`). Die Liste gilt für alle Spieler; im Titelmenü steht sie unter **BESTENLISTE** und erscheint
auch von selbst, wenn niemand spielt.

## Level-Editor

Im Titelmenü unter **LEVEL-EDITOR**: mit der Maus malen (links: Werkzeug, rechts: graben), Mausrad zum Scrollen,
Strg+Z zum Rückgängigmachen. **ZUFALL** würfelt ein komplettes Level aus, **ZUFALL LEER** nur den Gang.
Nach einem erfolgreichen Testlauf erzeugt **TEILEN** einen 6-stelligen Code; über einen Link
`…/#CODE` oder **LEVEL-CODE EINGEBEN** spielen andere das Level.

## Aufbau

```
public/          statische Seite, ohne Build-Schritt und ohne externe Abhängigkeiten
  game.js        Engine: Canvas 480×270, Pixelschrift, Sprites als Zeichenketten, WebAudio-Töne, Editor
  levels.js      Kampagnen-Level (Legende oben in der Datei)
api/             Level-API zum Teilen und Bestenliste (nur Python-Standardbibliothek + SQLite)
  app.py         POST /api/levels -> Code, GET /api/levels/CODE -> Level,
                 GET /api/scores -> Top 10, POST /api/scores -> Eintrag
tests/           Prüfungen mit Node: node tests/run.js
```

Die Level-Prüfung existiert zweimal und muss übereinstimmen: `checkRows()` in `public/game.js` und
`validate()` in `api/app.py` (Größe, erlaubte Zeichen, genau ein Start und ein Küken, Obergrenzen,
Küken erreichbar). Level enthalten bewusst keinen Freitext.

Die API begrenzt Uploads pro Anschluss und insgesamt, speichert keine IP-Adressen und gibt gleichen
Leveln denselben Code. Moderation: `python app.py show CODE` / `python app.py delete CODE`,
für die Bestenliste `python app.py scores` / `python app.py delscore ID`.

## Lokal ausprobieren

```sh
TUXO_DB=/tmp/levels.sqlite TUXO_PORT=8000 python3 api/app.py serve   # Level-API
cd public && python3 -m http.server 8080                              # Spiel (ohne API: nur Kampagne/Editor)
node tests/run.js                                                     # alle Prüfungen
```

Für das Teilen im Browser muss `/api/*` auf dieselbe Herkunft wie das Spiel zeigen (z. B. per Reverse Proxy).

## Lizenz

Gemeinfrei ([The Unlicense](LICENSE)): Jeder darf mit dem Code machen, was er will – kopieren, ändern,
weitergeben, verkaufen, auch ohne Namensnennung.

Tux ist das Maskottchen von Linux (ursprünglich von Larry Ewing); die Pixelgrafik hier ist eine eigene
Umsetzung. H.E.R.O. ist ein Spiel von Activision (1984), das hier nur als Vorbild dient.
