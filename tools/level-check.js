// Prüft ein von einer KI gebautes Level (Anleitung: tuxo-level-anleitung.md) und hängt es auf Wunsch an.
//
//   node tools/level-check.js DATEI            prüfen (JSON-Datei oder Text mit ```json-Block)
//   node tools/level-check.js DATEI --apply    prüfen und an public/levels.js anhängen
//
// Neben den Regeln aus checkRows() (game.js) wird geprüft: Abschnitte passen aneinander, das Küken ist erreichbar,
// ohne weiter als BACK_MAX Kacheln hinter den rechtesten erreichten Punkt zurückzumüssen (die Kamera scrollt nur
// nach rechts), und das Dynamit reicht für die nötigen Sprengungen.
'use strict';
const fs = require('fs');
const path = require('path');

const ROWS = 16, MIN_W = 30, MAX_W = 160;
const TILES = '.#XDLPC+*bswATR123456789';
const TEXT_CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ0123456789.,:!?-+/()\'<>=*"'; // Pixelschrift des Spiels
const BACK_MAX = 9; // die Kamera hält Tux bei 40 % der Bildbreite: gut 11 Kacheln, mit Reserve 9
const START_DYN = 6, MAX_DYN = 9, PICKUP_DYN = 3;
const LEVELS_JS = path.join(__dirname, '..', 'public', 'levels.js');

function extractJson(text) {
  const m = /```(?:json)?\s*\n([\s\S]*?)```/.exec(text);
  return JSON.parse(m ? m[1] : text);
}

const textOk = (s, max) => typeof s === 'string' && s.trim().length > 0 && s.length <= max &&
  s.toUpperCase().replace(/ß/g, 'SS').split('').every((c) => TEXT_CHARS.includes(c));

// Ergebnis: { errors: [...], warnings: [...], rows, info }
function checkLevel(L, checkRows) {
  const errors = [], warnings = [];
  const err = (m) => errors.push(m), warn = (m) => warnings.push(m);
  if (!L || typeof L !== 'object') return { errors: ['keine Level-Daten'], warnings };
  if (!textOk(L.ki, 24)) err('"ki" fehlt oder enthält Zeichen, die die Pixelschrift nicht kennt (max. 24 Zeichen)');
  if (!textOk(L.name, 24)) err('"name" fehlt oder ist ungültig (max. 24 Zeichen, nur Zeichen der Pixelschrift)');
  const hints = L.hints || {};
  if (typeof hints !== 'object' || Array.isArray(hints)) err('"hints" muss ein Objekt sein');
  for (const [k, v] of Object.entries(hints)) {
    if (!/^[1-9]$/.test(k)) err(`Hinweis "${k}": Schlüssel muss 1–9 sein`);
    const lines = typeof v === 'string' ? v.split('\n') : [];
    if (!lines.length || lines.length > 2 || !lines.every((l) => textOk(l, 44))) err(`Hinweis ${k}: höchstens 2 Zeilen à 44 Zeichen der Pixelschrift`);
  }
  const segs = L.segments;
  if (!Array.isArray(segs) || !segs.length || segs.length > 12) { err('"segments" muss 1–12 Abschnitte enthalten'); return { errors, warnings }; }
  segs.forEach((s, i) => {
    if (!Array.isArray(s) || s.length !== ROWS || !s.every((r) => typeof r === 'string')) return err(`Abschnitt ${i + 1}: genau 16 Zeilen nötig`);
    const w = s[0].length;
    if (s.some((r) => r.length !== w)) err(`Abschnitt ${i + 1}: alle Zeilen müssen gleich lang sein (${s.map((r) => r.length).join('/')})`);
    if (w < 4) err(`Abschnitt ${i + 1}: mindestens 4 Spalten`);
    s.forEach((r, y) => { const bad = [...r].filter((c) => !TILES.includes(c)); if (bad.length) err(`Abschnitt ${i + 1}, Zeile ${y + 1}: unbekannte Zeichen ${[...new Set(bad)].join('')}`); });
    if (i) for (let y = 0; y < ROWS; y++) {
      const prev = segs[i - 1][y] || '', a = prev[prev.length - 1] === '#', b = s[y] && s[y][0] === '#';
      if (a !== b) err(`Übergang Abschnitt ${i}/${i + 1}, Zeile ${y + 1}: Fels muss auf beiden Seiten der Naht gleich sein`);
    }
  });
  if (errors.length) return { errors, warnings };
  const raw = Array.from({ length: ROWS }, (_, y) => segs.map((s) => s[y]).join(''));
  const w = raw[0].length;
  if (w < MIN_W || w > MAX_W) err(`Gesamtbreite ${w}: erlaubt sind ${MIN_W}–${MAX_W} Spalten`);
  const digits = new Set(raw.join('').match(/[1-9]/g) || []);
  for (const d of digits) if (!hints[d]) err(`Hinweis-Ziffer ${d} steht im Level, aber "hints" hat keinen Text dafür`);
  for (const k of Object.keys(hints)) if (!digits.has(k)) warn(`Hinweis ${k} wird im Level nicht verwendet`);
  const rows = raw.map((r) => r.replace(/[1-9]/g, '.'));
  const basic = checkRows(rows);
  if (basic) err('Spielregel: ' + basic);
  if (errors.length) return { errors, warnings };

  // Weg zum Küken mit Kamera-Grenze und Sprengungen (0-1-Breitensuche über zusammenhängende Wandblöcke)
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= ROWS ? '#' : rows[y][x]);
  const comp = new Int32Array(w * ROWS).fill(-1);
  let nComp = 0;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < w; x++) {
    const ch = rows[y][x];
    if ((ch !== 'X' && ch !== 'D') || comp[y * w + x] >= 0) continue;
    const st = [[x, y]]; comp[y * w + x] = nComp;
    while (st.length) {
      const [cx, cy] = st.pop();
      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]])
        if (at(nx, ny) === ch && comp[ny * w + nx] < 0) { comp[ny * w + nx] = nComp; st.push([nx, ny]); }
    }
    nComp++;
  }
  let P, C;
  rows.forEach((r, y) => { if (r.includes('P')) P = [r.indexOf('P'), y]; if (r.includes('C')) C = [r.indexOf('C'), y]; });
  const open = (x, y) => { const c = at(x, y); return c !== '#' && c !== 'L'; };
  // Zustand: Position + rechtester erreichter Punkt; Kosten = gesprengte Blöcke (Näherung: jeder neue Block zählt)
  const key = (x, y, m) => (m * ROWS + y) * w + x;
  const best = new Map(), dq = [[P[0], P[1], P[0], 0, []]];
  best.set(key(P[0], P[1], P[0]), 0);
  let found = null;
  while (dq.length) {
    const [x, y, m, cost, blasted] = dq.shift();
    if (cost > (best.get(key(x, y, m)) ?? Infinity)) continue;
    if (x === C[0] && (y === C[1] || y - 1 === C[1])) { found = { cost, blasted }; break; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, nm = Math.max(m, nx);
      if (!open(nx, ny) || !open(nx, ny - 1) || nx < nm - BACK_MAX) continue;
      const cs = [comp[ny * w + nx], comp[(ny - 1) * w + nx]].filter((c) => c >= 0 && !blasted.includes(c));
      const nc = cost + new Set(cs).size, k = key(nx, ny, nm);
      if (nc >= (best.get(k) ?? Infinity)) continue;
      best.set(k, nc);
      const nb = cs.length ? [...blasted, ...new Set(cs)] : blasted;
      if (nc === cost) dq.unshift([nx, ny, nm, nc, nb]); else dq.push([nx, ny, nm, nc, nb]);
    }
  }
  const pickups = (rows.join('').match(/\+/g) || []).length;
  const dynAvail = Math.min(MAX_DYN, START_DYN + PICKUP_DYN * pickups);
  if (!found) err(`Küken nicht erreichbar, ohne mehr als ${BACK_MAX} Kacheln nach links zurückzugehen (die Kamera scrollt nur nach rechts)`);
  else if (found.cost > START_DYN + PICKUP_DYN * pickups) err(`Weg braucht mindestens ${found.cost} Sprengungen, verfügbar sind ${START_DYN} + ${PICKUP_DYN} pro Dynamit-Paket`);
  else if (found.cost > START_DYN) warn(`Weg braucht ${found.cost} Sprengungen – nur mit Dynamit-Paketen unterwegs zu schaffen`);
  const count = (re) => (rows.join('').match(re) || []).length;
  const info = { width: w, segments: segs.length, monsters: count(/[bswATR]/g), gems: count(/\*/g), dynPacks: pickups,
    blasts: found ? found.cost : null, dynAvail };
  if (info.monsters === 0) warn('keine Monster');
  return { errors, warnings, rows, info };
}

// Level als JavaScript-Objekt im Stil von levels.js
function toLevelsJs(L) {
  const q = (s) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
  const hints = Object.entries(L.hints || {}).map(([k, v]) => `      ${k}: ${q(v.toUpperCase())},`).join('\n');
  const segs = L.segments.map((s) => '      [\n' + s.map((r) => `        '${r}',`).join('\n') + '\n      ],').join('\n');
  return `  {\n    name: ${q(L.name.toUpperCase())},\n    ki: ${q(L.ki.toUpperCase())},\n` +
    (hints ? `    hints: {\n${hints}\n    },\n` : '') + `    segments: [\n${segs}\n    ],\n  },\n`;
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.log('Aufruf: node tools/level-check.js DATEI [--apply]'); process.exit(2); }
  const { load } = require('../tests/harness');
  const T = load();
  let L;
  try { L = extractJson(fs.readFileSync(file, 'utf8')); } catch (e) { console.log('FEHLER: kein gültiges JSON – ' + e.message); process.exit(1); }
  const r = checkLevel(L, T.checkRows);
  r.warnings.forEach((m) => console.log('Hinweis: ' + m));
  r.errors.forEach((m) => console.log('FEHLER:  ' + m));
  if (r.errors.length) process.exit(1);
  const i = r.info;
  console.log(`OK: "${L.name}" von ${L.ki} – ${i.width} Spalten, ${i.segments} Abschnitte, ${i.monsters} Monster, ` +
    `${i.gems} Edelsteine, ${i.dynPacks} Dynamit-Pakete, mind. ${i.blasts} Sprengungen`);
  if (process.argv.includes('--apply')) {
    const src = fs.readFileSync(LEVELS_JS, 'utf8');
    if (src.includes(`name: '${L.name.toUpperCase().replace(/'/g, "\\'")}'`)) { console.log('FEHLER: ein Level mit diesem Namen gibt es schon'); process.exit(1); }
    const end = src.lastIndexOf('];');
    fs.writeFileSync(LEVELS_JS, src.slice(0, end) + toLevelsJs(L) + src.slice(end));
    console.log('an public/levels.js angehängt');
  }
}

module.exports = { checkLevel, extractJson, toLevelsJs, BACK_MAX };
