# T.U.X.O.

Ein Höhlenabenteuer im 8-Bit-Stil, frei nach dem C64-Klassiker H.E.R.O.: Tux fliegt mit dem Jetpack
durch Höhlen, sprengt Wände, Türen und Monster mit Dynamit und rettet Pinguin-Küken.

Läuft als statische Seite im Browser; zum Teilen eigener Level gehört eine kleine API dazu.

## Steuerung

| Taste | Aktion |
|---|---|
| Pfeil links / rechts | laufen |
| Pfeil hoch | Jetpack – je länger gedrückt, desto höher; mit dem richtigen Rhythmus kann man schweben |
| Pfeil runter | ducken (am Boden), weicht Lasern und Äxten aus |
| Leertaste | Dynamit ablegen (explodiert nach 2 Sekunden) |
| P / Esc | Pause |
| M | Ton an/aus |

Auf Touch-Geräten erscheinen Bildschirmknöpfe.

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
api/             Level-API zum Teilen (nur Python-Standardbibliothek + SQLite)
  app.py         POST /api/levels -> Code, GET /api/levels/CODE -> Level
tests/           Prüfungen mit Node: node tests/run.js
```

Die Level-Prüfung existiert zweimal und muss übereinstimmen: `checkRows()` in `public/game.js` und
`validate()` in `api/app.py` (Größe, erlaubte Zeichen, genau ein Start und ein Küken, Obergrenzen,
Küken erreichbar). Level enthalten bewusst keinen Freitext.

Die API begrenzt Uploads pro Anschluss und insgesamt, speichert keine IP-Adressen und gibt gleichen
Leveln denselben Code. Moderation: `python app.py show CODE` / `python app.py delete CODE`.

## Lokal ausprobieren

```sh
TUXO_DB=/tmp/levels.sqlite TUXO_PORT=8000 python3 api/app.py serve   # Level-API
cd public && python3 -m http.server 8080                              # Spiel (ohne API: nur Kampagne/Editor)
node tests/run.js                                                     # alle Prüfungen
```

Für das Teilen im Browser muss `/api/*` auf dieselbe Herkunft wie das Spiel zeigen (z. B. per Reverse Proxy).
