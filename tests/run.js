// Alle Prüfungen: node tests/run.js   (braucht Node 18+ und python3 für die Level-API)
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { load, key } = require('./harness');

let failed = 0;
const ok = (c, m) => { if (!c) failed++; console.log((c ? '  ok    ' : '  FEHL  ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // Level-API mit Wegwerf-Datenbank starten
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tuxo-test-'));
  const port = 18000 + Math.floor(Math.random() * 1000);
  const api = spawn('python3', [path.join(__dirname, '..', 'api', 'app.py'), 'serve'],
    { env: { ...process.env, TUXO_DB: path.join(tmp, 'levels.sqlite'), TUXO_PORT: String(port) }, stdio: 'ignore' });
  await sleep(800);
  const T = load(`http://127.0.0.1:${port}`);
  const step = (n = 1) => { for (let i = 0; i < n; i++) { T.update(1 / 60); if (i % 4 === 0) T.draw(); } };
  const run = (sec, until) => { for (let i = 0; i < sec * 60; i++) { T.update(1 / 60); if (i % 4 === 0) T.draw(); if (until && until()) return; } };
  const press = (code, sec) => { key(code, true); run(sec); key(code, false); };
  const tap = (code) => { key(code, true); key(code, false); };
  const clickAt = (x, y, btn = 0) => {
    Object.assign(T.mouse, { x, y, down: true, button: btn });
    if (btn === 2) T.mouse.rclicked = true; else T.mouse.clicked = true;
    step();
  };
  const release = () => { T.mouse.down = false; step(); };
  const mid = (r) => [r.x + r.w / 2, r.y + r.h / 2];
  const wait = async (cond) => { for (let i = 0; i < 100 && !cond(); i++) await sleep(20); };
  const toChick = () => { T.p.x = T.chick.x; T.p.y = T.chick.y - 10; run(0.2); };

  try {
    console.log('Kampagnen-Level');
    window.TUXO_LEVELS.forEach((L, i) => {
      const rows = []; for (let r = 0; r < 16; r++) rows.push(L.segments.map((s) => s[r]).join(''));
      const clean = rows.map((r) => r.replace(/[1-9]/g, '.'));
      ok(!T.checkRows(clean), `Level ${i + 1} "${L.name}": ${T.checkRows(clean) || 'gültig, Küken erreichbar'}`);
      L.segments.forEach((s, si) => {
        if (si) for (let r = 0; r < 16; r++) {
          const prev = L.segments[si - 1][r];
          if ((prev[prev.length - 1] === '#') !== (s[r][0] === '#')) ok(false, `Level ${i + 1}: Übergang Abschnitt ${si}/${si + 1}, Zeile ${r}`);
        }
      });
    });

    console.log('Schnitzel-Modus');
    const typeCode = () => { for (const c of 'IDDQDIDKFA') tap('Key' + c); step(); };
    typeCode();
    ok(T.schnitzel && T.schFx && T.schFx.on, 'IDDQDIDKFA im Titel aktiviert den Schnitzel-Modus');
    ok(T.SPR.stand === T.SKINS.schnitzel.stand && T.SPR.fly === T.SKINS.schnitzel.fly, 'Spielfigur ist das Schnitzel');
    tap('Enter'); step();
    ok(T.state === 'title' && T.schFx, 'Enter startet während der Animation kein Spiel');
    run(7);
    ok(!T.schFx && T.state === 'title', 'Animation endet von selbst');
    typeCode(); run(4);
    ok(!T.schnitzel && T.SPR.stand === T.SKINS.tux.stand, 'erneut IDDQDIDKFA: wieder Tux');
    typeCode(); run(1.6); tap('Enter'); step();
    ok(T.schnitzel && !T.schFx && T.state === 'title', 'Animation lässt sich mit Enter überspringen');
    typeCode(); run(4);
    ok(!T.schnitzel, 'zurückgeschaltet für die weiteren Tests');
    T.startGame(); run(0.1); typeCode();
    ok(!T.schnitzel, 'Code wirkt nur im Titelmenü');
    T.setState('title'); step();

    console.log('Steuerung und Spielmechanik');
    tap('Enter'); step(); run(2.5);
    ok(T.state === 'play', 'Titel -> Spiel');
    run(1);
    const gy = T.p.y;
    press('ArrowUp', 0.6); const h1 = gy - T.p.y; run(2);
    press('ArrowUp', 1.2); const h2 = gy - T.p.y; run(2);
    ok(h1 > 20 && h2 > h1, `Jetpack: länger drücken = höher (${h1.toFixed(0)} px / ${h2.toFixed(0)} px)`);
    key('ArrowUp', true); run(1.2); key('ArrowUp', false); run(0.6);
    const vFall = T.p.vy, yFall = T.p.y; key('ArrowUp', true); run(1, () => T.p.vy <= 0); key('ArrowUp', false);
    ok(T.p.y - yFall < 48, `Abfangen aus dem Fall (${vFall.toFixed(0)} px/s) nach ${(T.p.y - yFall).toFixed(0)} px`);
    run(2);
    press('ArrowRight', 4); press('ArrowLeft', 5);
    ok(T.p.x >= T.cam.x, 'nach links nur im sichtbaren Bereich');
    key('ArrowRight', true);
    for (let i = 0; i < 3; i++) { press('ArrowUp', i ? 0.5 : 1.0); run(0.3); }
    run(5); key('ArrowRight', false);
    ok(T.p.x > 46 * 16 && T.p.x < 48 * 16, 'über den Block geflogen, steht vor der rissigen Wand');
    const dyn0 = T.p.dyn; tap('Space'); step();
    ok(T.dyn && T.p.dyn === dyn0 - 1, 'Dynamit gelegt');
    press('ArrowLeft', 1.2); run(1.5);
    ok(!T.grid.some((r) => r.includes('X')) && T.state === 'play', 'Wand komplett gesprengt, Tux lebt');
    tap('Space'); run(2.3);
    ok(T.state === 'dying', 'neben dem eigenen Dynamit stehen bleiben = Lebensverlust');
    run(2.5);
    ok(T.state === 'play' && T.lives === 2, 'Neustart am Rücksetzpunkt');
    // Laser-Korridor
    T.p.x = 63 * 16; T.p.y = 189; T.cam.x = 63 * 16 - 200; T.p.inv = 0;
    key('ArrowDown', true); let shots = 0; run(5); for (let i = 0; i < 300; i++) { step(); if (T.shots.length) shots++; }
    key('ArrowDown', false);
    ok(T.state === 'play' && shots > 0, 'geduckt fliegen Laserschüsse über Tux hinweg');
    run(4, () => T.state === 'dying');
    ok(T.state === 'dying', 'aufrecht trifft der Laser');

    console.log('Alle Kampagnen-Level abschließen, Zufallseingaben');
    for (let lv = 0; lv < window.TUXO_LEVELS.length; lv++) {
      T.loadLevel(lv); T.setState('play');
      let err = null;
      try {
        const codes = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'];
        for (let i = 0; i < 60 * 30; i++) {
          if (i % 20 === 0) codes.forEach((c) => key(c, Math.random() < (c === 'ArrowRight' ? 0.7 : c === 'ArrowUp' ? 0.4 : 0.15)));
          step();
          if (T.state === 'gameover' || T.state === 'title') { T.startGame(); T.loadLevel(lv); T.setState('play'); }
        }
        codes.forEach((c) => key(c, false));
      } catch (e) { err = e; }
      ok(!err, `Level ${lv + 1}: 30 s Zufallseingaben ohne Laufzeitfehler${err ? ': ' + err.stack : ''}`);
      T.loadLevel(lv); T.setState('play'); step();
      toChick();
      ok(T.state === 'clear', `Level ${lv + 1}: Küken erreicht -> Bonuszählung`);
    }

    console.log('Zufallsgenerator');
    let bad = 0, n = 0;
    for (let w = 40; w <= 160; w += 10) for (let i = 0; i < 20; i++) for (const full of [false, true]) {
      n++; if (T.checkRows(T.genLevel(w, full).map((r) => r.join('')))) bad++;
    }
    ok(bad === 0, `${n} Zufallslevel, ungültig: ${bad}`);
    const empty = T.genLevel(100, false).map((r) => r.join('')).join('');
    ok(!/[XDLbswATR+*]/.test(empty), 'ZUFALL LEER enthält keine Hindernisse, Monster oder Gegenstände');

    console.log('Editor, Teilen, Laden');
    T.setState('title'); step();
    clickAt(...mid(T.menuRects()[1])); release();
    ok(T.state === 'editor', 'Titelmenü -> Editor per Mausklick');
    clickAt(...mid(T.TOOL_RECT(T.TOOLS.findIndex((t) => t[0] === 'X')))); release();
    clickAt(32 + 3 * 16 + 8, 14 + 5 * 16 + 8); release();
    ok(T.ed.rows[5][3] === 'X', 'Werkzeug wählen und Kachel setzen');
    clickAt(32 + 4 * 16 + 8, 14 + 2 * 16 + 8, 2);
    for (let x = 5; x <= 8; x++) { T.mouse.x = 32 + x * 16 + 8; step(); }
    release();
    ok([4, 5, 6, 7, 8].every((x) => T.ed.rows[2][x] === '.'), 'rechte Maustaste + Ziehen gräbt');
    T.hit.Undo = true; step();
    ok(T.ed.rows[2][4] === '#', 'Strg+Z nimmt den ganzen Pinselstrich zurück');
    const btn = (id) => mid(T.ED_BUTTONS.find((b) => b.id === id));
    clickAt(...btn('rand')); release();
    clickAt(...btn('share')); release();
    ok(/ERST TESTEN/.test(T.ed.msg), 'Teilen ohne Durchspielen wird verweigert');
    clickAt(...btn('test')); release();
    ok(T.mode === 'test', 'Testlauf startet');
    run(2.5); toChick(); run(10, () => T.state === 'editor');
    ok(T.state === 'editor' && /GESCHAFFT/.test(T.ed.msg), 'nach dem Testlauf zurück im Editor');
    clickAt(...btn('share')); release();
    await wait(() => T.state !== 'busy');
    const code = T.ed.share && T.ed.share.code;
    ok(T.state === 'share' && /^[2-9A-HJKMNP-Z]{6}$/.test(code || ''), `Teilen liefert Code ${code}`);
    tap('Enter'); step();
    T.loadByCode(code); await wait(() => T.state !== 'busy');
    ok(T.state === 'intro' && T.mode === 'custom', `Level ${code} per Code geladen`);
    run(2.5); toChick(); run(10, () => T.state === 'customdone');
    ok(T.state === 'customdone', 'geteiltes Level geschafft');
    T.loadByCode('ZZZZZZ'); await wait(() => T.state !== 'busy');
    ok(T.state === 'codeinput', 'unbekannter Code -> Fehlermeldung in der Eingabe');
  } catch (e) {
    ok(false, 'Abbruch: ' + e.stack);
  } finally {
    api.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen` : '\nAlle Prüfungen bestanden');
  process.exit(failed ? 1 : 0);
})();
