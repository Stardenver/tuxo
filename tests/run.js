// Alle Prüfungen: node tests/run.js   (braucht Node 18+ und python3 für die Level-API)
'use strict';
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { load, key, PUBLIC } = require('./harness');

let failed = 0;
const ok = (c, m) => { if (!c) failed++; console.log((c ? '  ok    ' : '  FEHL  ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // Level-API mit Wegwerf-Datenbank starten
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tuxo-test-'));
  const port = 18000 + Math.floor(Math.random() * 1000);
  const dbFile = path.join(tmp, 'levels.sqlite'), levelsFile = path.join(__dirname, '..', 'public', 'levels.js');
  const appPy = path.join(__dirname, '..', 'api', 'app.py');
  const sql = (q) => spawnSync('python3', ['-c', 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute(sys.argv[2]); c.commit()', dbFile, q]);
  const postScore = (body) => fetch('/api/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, ...(await r.json()) }));
  const newRun = () => fetch('/api/runs', { method: 'POST' }).then((r) => r.json()).then((j) => j.run);
  const api = spawn('python3', [path.join(__dirname, '..', 'api', 'app.py'), 'serve'],
    { env: { ...process.env, TUXO_DB: dbFile, TUXO_PORT: String(port), TUXO_LEVELS: levelsFile }, stdio: 'ignore' });
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

    console.log('Level-Prüfung für KI-Level (tools/level-check.js)');
    {
      const { checkLevel, extractJson, toLevelsJs } = require('../tools/level-check');
      window.TUXO_LEVELS.forEach((L, i) => {
        const r = checkLevel(L, T.checkRows);
        ok(!r.errors.length && L.ki, `Level ${i + 1} besteht die KI-Prüfung (${r.errors.join('; ') || 'von ' + L.ki})`);
      });
      const base = JSON.parse(JSON.stringify(window.TUXO_LEVELS[0]));
      const bad = (mutate) => { const L = JSON.parse(JSON.stringify(base)); mutate(L); return checkLevel(L, T.checkRows).errors; };
      ok(bad((L) => { delete L.ki; }).length, 'ohne KI-Namen: Fehler');
      ok(bad((L) => { L.segments[1][5] = L.segments[1][5].slice(1); }).length, 'ungleich lange Zeilen: Fehler');
      ok(bad((L) => { L.segments[1] = L.segments[1].map((r) => '#' + r.slice(1)); }).length, 'Naht zwischen Abschnitten passt nicht: Fehler');
      ok(bad((L) => { L.segments[4] = L.segments[4].map((r) => r.replace(/[^#]/g, '#')); L.segments[3] = L.segments[3].map((r, y) => y === 6 ? r.slice(0, -1) + 'C' : r.replace('C', '.')); }).length, 'Küken eingemauert oder Naht kaputt: Fehler');
      // Rückweg: Küken ganz links hinter dem Start – mit der Kamera nicht erreichbar
      const back = bad((L) => {
        const rows = Array.from({ length: 16 }, (_, y) => (y < 3 || y > 12 ? '#'.repeat(40) : '#' + '.'.repeat(38) + '#'));
        rows[12] = '#C' + '.'.repeat(30) + 'P' + '.'.repeat(6) + '#';
        L.segments = [rows]; L.hints = {};
      });
      ok(back.some((m) => /nach links/.test(m)), `Küken nur durch Zurücklaufen erreichbar: Fehler (${back[0]})`);
      ok(extractJson('Hier ist dein Level:\n```json\n{"a": 1}\n```\nViel Spaß').a === 1, 'JSON wird aus einer KI-Antwort mit Codeblock gelesen');
      const js = toLevelsJs({ ...base, name: "DAS 'LOCH'", ki: 'Gemini 2.5 Pro' });
      const back2 = Function('return ' + js.trim().replace(/,$/, ''))();
      ok(back2.name === "DAS 'LOCH'" && back2.ki === 'GEMINI 2.5 PRO' && back2.segments.length === base.segments.length, 'Ausgabe für levels.js ist gültiges JavaScript');
    }

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
    {
      const f0 = T.p.fuel; run(3);
      ok(T.p.fuel === f0, 'Treibstoff: Stehen kostet nichts');
      const ys = T.p.y; key('Space', true); run(1); const yUp = T.p.y; key('Space', false); run(1.5);
      const used = f0 - T.p.fuel;
      ok(ys - yUp > 40, `Leertaste = Jetpack (${((ys - yUp) / 16).toFixed(1)} Kacheln in 1 s)`);
      ok(used > 1 && used < 3, `1 s Jetpack verbraucht ${used.toFixed(1)} von 100`);
      const lives0 = T.lives; T.p.fuel = 0.5; T.p.energy = 100; // frühere Flüge im Test haben schon Fallschaden gemacht
      key('ArrowUp', true); run(1); key('ArrowUp', false); run(1.5);
      ok(T.p.empty && T.p.fuel === 0 && !T.p.thrusting && T.state === 'play' && T.p.energy === 100, 'leerer Tank: Jetpack setzt aus, sonst passiert nichts');
      const y0 = T.p.y; key('ArrowUp', true); run(1); key('ArrowUp', false);
      ok(T.p.y === y0, 'mit leerem Tank kein Dauerflug');
      tap('Space'); let jtop = T.p.y; for (let i = 0; i < 60; i++) { step(); jtop = Math.min(jtop, T.p.y); }
      const jh = (y0 - jtop) / 16;
      ok(jh > 1.5 && jh < 2.6, `leerer Tank: Leertaste springt ${jh.toFixed(1)} Kacheln hoch`);
      key('Space', true); run(0.1); key('Space', true); run(1.5); const y2 = T.p.y; run(0.5); key('Space', false);
      ok(T.p.y === y2 && T.p.y === y0, 'gehaltene Leertaste springt nur einmal');
      T.p.fuel = 100; T.p.empty = false;
      press('ArrowUp', 0.6); run(2);
      ok(T.p.energy === 100, 'kleiner Sprung (ca. 4 Kacheln): kein Fallschaden');
      press('ArrowUp', 2.2); const top = T.p.y; run(2);
      const dmg = 100 - T.p.energy;
      ok(T.p.y - top > 6 * 16 && dmg > 0 && dmg < 30, `tiefer Fall (${((T.p.y - top) / 16).toFixed(1)} Kacheln): ${dmg} Energie Schaden`);
      const e1 = T.p.energy;
      press('ArrowUp', 2.2); run(0.5);
      key('ArrowUp', true); run(0.4, () => T.p.vy < 50); key('ArrowUp', false);
      ok(T.p.vy < 60, 'gleiche Höhe, aber mit dem Jetpack abgebremst ...'); run(0.25); key('ArrowUp', true); run(0.15); key('ArrowUp', false); run(2);
      ok(T.p.energy >= e1 - 5, `... kaum Fallschaden (${e1 - T.p.energy})`);
      T.p.fuel = 0; T.p.empty = true;
      tap('KeyP'); step(); tap('KeyR'); tap('KeyQ'); tap('Enter'); step();
      ok(T.state === 'play' && T.paused, 'Pause: R, Q und Enter tun nichts (Bedienung per Maus)');
      tap('KeyP'); step();
      ok(!T.paused, 'P setzt fort'); tap('KeyP'); step();
      clickAt(...mid(T.pauseButtons()[1])); release();
      ok(T.state === 'dying', 'Pause -> NEU VERSUCHEN kostet ein Leben');
      run(2.5, () => T.state === 'play');
      ok(T.lives === lives0 - 1 && T.p.fuel === 100 && T.p.energy === 100 && !T.p.empty, 'danach voller Tank und volle Energie');
      run(2.1);
    }
    press('ArrowRight', 4); press('ArrowLeft', 5);
    ok(T.p.x >= T.cam.x, 'nach links nur im sichtbaren Bereich');
    key('ArrowRight', true);
    for (let i = 0; i < 3; i++) { press('ArrowUp', i ? 0.5 : 1.0); run(0.3); }
    run(5); key('ArrowRight', false);
    ok(T.p.x > 46 * 16 && T.p.x < 48 * 16, 'über den Block geflogen, steht vor der rissigen Wand');
    tap('ShiftLeft'); tap('ShiftRight'); step();
    ok(!T.dyn, 'Shift legt kein Dynamit (Taste entfällt)');
    const dyn0 = T.p.dyn; tap('KeyE'); step();
    ok(T.dyn && T.p.dyn === dyn0 - 1, 'Dynamit gelegt');
    press('ArrowLeft', 1.2); run(1.5);
    ok(!T.grid.some((r) => r.includes('X')) && T.state === 'play', 'Wand komplett gesprengt, Tux lebt');
    const livesDyn = T.lives;
    tap('KeyE'); run(2.3);
    ok(T.state === 'dying', 'neben dem eigenen Dynamit stehen bleiben = Lebensverlust');
    run(2.5);
    ok(T.state === 'play' && T.lives === livesDyn - 1, 'Neustart am Rücksetzpunkt');
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
        const codes = ['ArrowLeft', 'ArrowRight', 'Space', 'ArrowDown', 'KeyE'];
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

    console.log('Zeitwertung');
    T.startGame(); run(2.5);
    toChick(); run(0.1);
    const fastBonus = T.lastTimeBonus;
    ok(fastBonus > 0, `schnell geschafft: Zeitbonus ${fastBonus} (Sollzeit ${T.parTime()} s)`);
    const sBefore = T.score; run(10, () => T.state === 'intro');
    ok(T.score - sBefore >= fastBonus, 'Zeitbonus wird in der Bonuszählung gutgeschrieben');
    run(2.5); T.lvlT = T.parTime() + 5; toChick(); run(0.1);
    ok(T.lastTimeBonus === 0, 'über der Sollzeit: kein Zeitbonus');
    T.setState('title'); step();

    console.log('Laser nach Edelstein');
    {
      const rows = ['#'.repeat(40)];
      for (let r = 1; r < 13; r++) rows.push('#' + '.'.repeat(38) + '#');
      rows.push('#.P*' + '.'.repeat(34) + 'C#', '#'.repeat(40), '#'.repeat(40));
      T.startCustom(rows, 'TEST', false); run(2.5);
      T.p.face = 1; tap('KeyB'); step();
      ok(!T.laserUsed && !T.beam, 'ohne Edelstein passiert mit B nichts');
      const gem = T.pickups.find((k) => k.kind !== 'dyn');
      T.p.x = gem.x; T.p.y = gem.y - 6; step();
      ok(T.laserReady, 'Edelstein eingesammelt -> Laser bereit');
      run(1); T.p.face = 1;
      const ly = T.p.y + 8, bat = (dx, dy = 0) => ({ kind: 'bat', x: T.p.x + dx, y: ly - 3 + dy, w: 14, h: 7, hx: T.p.x + dx, by: ly - 3 + dy, vx: 0, t: 0, pts: 50 });
      const b1 = bat(40), b2 = bat(90), b3 = bat(200), b4 = bat(60, -40);
      T.enemies.push(b1, b2, b3, b4);
      T.grid[Math.floor(ly / 16)][Math.floor((T.p.x + 150) / 16)] = '#';
      const s0 = T.score; tap('KeyB'); step();
      ok(b1.dead && b2.dead, 'Laser trifft alle Monster in der Linie');
      ok(!b3.dead, 'Hindernis stoppt den Laser');
      ok(!b4.dead, 'Monster außerhalb der Linie bleiben verschont');
      ok(T.score - s0 >= 100 && T.beam && T.laserUsed, 'Punkte für die Treffer, Strahl sichtbar');
      run(0.5);
      T.p.x = gem.x; tap('KeyB'); step();
      ok(!T.beam, 'nur einmal pro Level');
      T.loadLevel(0); step();
      ok(!T.laserUsed && !T.laserReady, 'neues Level: Laser erst wieder nach einem Edelstein');
      T.setState('title'); step();
    }

    console.log('Bestenliste');
    await wait(() => T.board.status !== 'loading');
    ok(T.board.status === 'ok' && T.board.list.length === 0, 'Bestenliste beim Start geladen (leer)');
    T.startGame(); run(0.1);
    await wait(() => T.run.token);
    ok(/^[\w-]{22}$/.test(T.run.token || '') && !T.run.practice, 'Spielstart holt eine Spielrunde vom Server');
    T.score = 432; T.finishGame();
    await wait(() => T.board.status !== 'loading');
    ok(T.qualifies(432) && !T.qualifies(0), 'genug Punkte für die Liste, 0 Punkte nicht');
    run(1.6); tap('Enter'); step();
    ok(T.state === 'nameentry', 'Game Over -> Namenseingabe');
    for (const c of 'TESTER') tap('Key' + c);
    step();
    tap('ArrowUp'); step();
    ok(T.nm.s === 'TESTERA', `Pfeil hoch hängt ein Zeichen an (${T.nm.s})`);
    tap('ArrowDown'); step();
    tap('Enter'); step();
    await wait(() => T.state !== 'busy');
    ok(T.state === 'scores' && T.board.mine === 0 && T.board.list[0] && T.board.list[0].name === 'TESTER' && T.board.list[0].score === 432,
      `Eintrag gespeichert und markiert (${JSON.stringify(T.board.list[0])})`);
    run(1.1); tap('Enter'); step();
    ok(T.state === 'title', 'Bestenliste -> Titelmenü');
    run(26);
    ok(T.state === 'scores' && T.board.attract, 'Leerlauf im Titel zeigt die Bestenliste');
    run(11);
    ok(T.state === 'title', '... und kehrt von selbst zurück');
    clickAt(...mid(T.menuRects()[3])); release();
    ok(T.state === 'scores', 'Menüpunkt BESTENLISTE');
    T.setState('title'); step();

    console.log('Bestenliste: Schutz gegen gefälschte Einträge');
    const pyLevels = spawnSync('python3', [appPy, 'levels', '--json'], { env: { ...process.env, TUXO_DB: dbFile, TUXO_LEVELS: levelsFile } });
    const jsRows = window.TUXO_LEVELS.map((L) => { const r = []; for (let i = 0; i < 16; i++) r.push(L.segments.map((s) => s[i]).join('').replace(/[1-9]/g, '.')); return r; });
    ok(String(pyLevels.stdout).trim().split('\n').pop() === JSON.stringify(jsRows), 'API liest dieselben Level wie das Spiel');
    let res = await postScore({ name: 'FAKE', score: 99999, levels: 10 });
    ok(res.status === 400 && /SPIELRUNDE/.test(res.error), `ohne Spielrunde abgelehnt (${res.error})`);
    let tok = await newRun();
    res = await postScore({ name: 'FAKE', score: 99999, levels: 10, run: tok });
    ok(res.status === 400 && res.error === 'UNGÜLTIGE PUNKTZAHL', 'zu viele Punkte für 10 Level abgelehnt');
    res = await postScore({ name: 'FAKE', score: 100, levels: 0, run: tok });
    ok(res.status === 400 && /SPIELRUNDE/.test(res.error), 'Spielrunde ist danach verbraucht');
    tok = await newRun();
    res = await postScore({ name: 'FAKE', score: 1000, levels: 2, run: tok });
    ok(res.status === 400 && res.error === 'UNGÜLTIGE PUNKTZAHL', '2 Level in wenigen Sekunden: abgelehnt');
    tok = await newRun();
    sql(`UPDATE runs SET created = created - 50 WHERE token = '${tok}'`);
    res = await postScore({ name: 'ECHT', score: 8000, levels: 2, run: tok });
    ok(res.status === 201, `2 Level in 50 s mit 8000 Punkten: angenommen (${res.status} ${res.error || ''})`);
    tok = await newRun();
    sql(`UPDATE runs SET created = created - 50 WHERE token = '${tok}'`);
    res = await postScore({ name: 'FAKE', score: 9000, levels: 2, run: tok });
    ok(res.status === 400, 'mehr Punkte, als 2 Level hergeben: abgelehnt');
    tok = await newRun();
    sql(`UPDATE runs SET created = created - 13 * 3600 WHERE token = '${tok}'`);
    res = await postScore({ name: 'FAKE', score: 100, levels: 0, run: tok });
    ok(res.status === 400 && /SPIELRUNDE/.test(res.error), 'abgelaufene Spielrunde abgelehnt');
    location.hash = '#level=3'; T.fromHash(); run(0.1);
    ok(T.levelIdx === 2 && T.run.practice, 'Start per #level=3 ist eine Übungsrunde');
    T.score = 99999; T.finishGame(); await wait(() => T.board.status !== 'loading');
    T.afterGameOver();
    ok(T.state === 'scores', 'Übungsrunde: keine Namenseingabe');
    location.hash = ''; T.setState('title'); step();

    console.log('Die Hexe');
    const names = ['KIM88', 'SAMUEL', 'TIMO!!!!!!', 'XTIMOX', 'ACTIONSCHN', 'ACTION SCH', 'T1MO', 'T.I.M.O', 'TIIMO', 'T-1-M-0',
      'K1M 88', 'KIM88!', 'KIMBB', 'SAMU3L', '5AMUE1', 'SCHNITZEL', 'SCHN1TZ3L', 'SCHNITZ.EL', '4CT1ON5CH', 'KIM888', 'SSAMUEL'];
    const missed = names.filter((n) => !T.isCheater(n));
    ok(!missed.length, `alle ${names.length} Schreibweisen erkannt${missed.length ? ' – nicht: ' + missed.join(', ') : ''}`);
    const wrong = ['ACTIONFETA', 'TESTER', 'TIM', 'KIM8', 'H4NOVER', 'WOLLE!', 'GERBIL', 'ATODATZEL', 'GOTTKAISER', 'DENVSTARER', 'KIMBERLY', 'TIMBO', 'SAMU'].filter(T.isCheater);
    ok(!wrong.length, `andere Namen bleiben unbehelligt${wrong.length ? ' – fälschlich: ' + wrong.join(', ') : ''}`);
    const toNameEntry = async (pts) => {
      T.startGame(); run(0.1); await wait(() => T.run.token);
      T.score = pts; T.finishGame(); await wait(() => T.board.status !== 'loading');
      run(1.6); tap('Enter'); step();
    };
    await toNameEntry(1001);
    for (const c of 'SAMUEL') tap('Key' + c);
    step(); tap('Enter'); step();
    ok(T.state === 'witch' && T.witch.from === 1001 && T.witch.to === 500 && T.witch.ok, 'Cheater-Name ruft die Hexe (1001 -> 500)');
    run(3); tap('Enter'); tap('Escape'); clickAt(240, 135); release();
    ok(T.state === 'witch' && !T.witch.go, 'Tasten und Klicks während des Spruchs bleiben wirkungslos');
    run(T.witch.hold + 20);
    ok(T.state === 'witch' && !T.witch.go && T.witch.t === T.witch.hold, 'nach dem Spruch wartet die Hexe (auch 20 s lang)');
    tap('Enter'); step();
    ok(T.witch.go && T.witch.t > T.witch.hold, 'Taste -> sie schwingt den Zauberstab');
    run(T.witch.end, () => T.state !== 'witch');
    await wait(() => T.state !== 'busy');
    const mine = T.board.list[T.board.mine];
    ok(T.state === 'scores' && mine && mine.name === 'SAMUEL' && mine.score === 500, `halbierte Punkte eingetragen (${JSON.stringify(mine)})`);
    T.setState('title'); step();
    await toNameEntry(1001);
    T.board.list = Array.from({ length: 10 }, () => ({ name: 'ECHT', score: 5000, levels: 3 }));
    for (const c of 'TIMO') tap('Key' + c);
    step(); tap('Enter'); step();
    ok(T.state === 'witch' && !T.witch.ok, 'halbiert reicht es nicht mehr für die Liste');
    run(T.witch.hold + 0.1); clickAt(240, 135); release();
    ok(T.witch.go, 'Mausklick setzt die wartende Hexe fort');
    run(T.witch.end + 1);
    ok(T.state === 'witch', 'Upsi bleibt stehen, bis jemand etwas drückt');
    tap('KeyX'); step();
    ok(T.state === 'title' && !T.witch, 'beliebige Taste -> Titelmenü, nichts eingetragen');
    await toNameEntry(1001);
    T.board.list = Array.from({ length: 10 }, () => ({ name: 'ECHT', score: 5000, levels: 3 }));
    for (const c of 'TIMO') tap('Key' + c);
    step(); tap('Enter'); step(); run(T.witch.hold + 0.1); tap('Space'); step(); run(T.witch.end + 0.1); clickAt(240, 135); release();
    ok(T.state === 'title', 'Mausklick -> Titelmenü');
    T.setState('title'); step();

    console.log('C64-Android und Arkanoid');
    {
      const walkers = () => T.enemies.filter((e) => e.kind === 'bug' || e.kind === 'troll');
      T.startGame();
      do T.loadLevel(2); while (T.enemies.some((e) => e.kind === 'c64')); // Vergleichsstand ohne Zufalls-Android
      const before = walkers(), sumPts = (l) => l.reduce((s, e) => s + e.pts, 0), all0 = sumPts(T.enemies);
      T.forceC64 = true; T.loadLevel(2);
      let droid = T.enemies.find((e) => e.kind === 'c64');
      ok(droid && droid.hp === 2 && walkers().length === before.length - 1, 'Android ersetzt einen Käfer oder Troll');
      ok(sumPts(T.enemies) === all0, 'Punkte im Level bleiben gleich (Grenze der Bestenliste)');
      let n = 0;
      for (let i = 0; i < 400; i++) { T.loadLevel(2); if (T.enemies.some((e) => e.kind === 'c64')) n++; }
      ok(n > 30 && n < 100, `selten: ${n} von 400 Levelstarts (erwartet ca. 60)`);
      n = 0;
      for (let i = 0; i < 100; i++) { T.loadLevel(0); if (T.enemies.some((e) => e.kind === 'c64')) n++; }
      ok(n === 0, 'Level ohne Laufgegner bekommen keinen Android');
      T.forceC64 = true; T.loadLevel(2); T.setState('play');
      droid = T.enemies.find((e) => e.kind === 'c64');
      T.p.inv = 999; T.p.x = droid.x - 100;
      const s0 = T.score;
      T.explode(droid.x + 7, droid.y + 8);
      ok(!droid.dead && droid.hp === 1 && !T.relic, 'erste Sprengung: nur angeschlagen');
      T.explode(droid.x + 7, droid.y + 8);
      ok(droid.dead && T.relic && T.score - s0 >= droid.pts, `zweite Sprengung: besiegt, C64 bleibt liegen, ${droid.pts} Punkte`);
      // Klick auf den C64
      T.cam.x = Math.max(0, T.relic.x - 200); step();
      clickAt(T.relic.x - T.cam.x + 8, T.relic.y + 14 + 2); release();
      ok(T.state === 'arkanoid' && T.ark && !T.relic, 'Klick auf den C64 startet Arkanoid');
      const lvlT0 = T.lvlT, ex = T.enemies.filter((e) => !e.dead).map((e) => e.x + ',' + e.y).join();
      key('ArrowRight', true); run(2); key('ArrowRight', false);
      ok(T.lvlT === lvlT0 && T.enemies.filter((e) => !e.dead).map((e) => e.x + ',' + e.y).join() === ex, 'Spiel steht still: keine Zeit, keine Monster');
      run(1.2);
      ok(T.ark.phase === 'play', 'nach dem C64-Startbildschirm läuft das Spiel');
      // echte Ballphysik: der Schläger folgt dem Ball
      let out = false;
      for (let i = 0; i < 60 * 90 && T.ark && T.ark.phase === 'play'; i++) {
        const a = T.ark, bx = a.ball.x + 1.5, mid = a.px + a.pw / 2;
        T.keys.ArrowLeft = bx < mid - 6; T.keys.ArrowRight = bx > mid + 6;
        step();
        if (T.ark && (T.ark.ball.x < T.AF.x - 1 || T.ark.ball.x > T.AF.x + T.AF.w || T.ark.ball.y < T.AF.y - 1)) out = true;
      }
      T.keys.ArrowLeft = T.keys.ArrowRight = false;
      ok(!out, 'Ball bleibt im Spielfeld');
      ok(T.ark && T.ark.phase === 'won', `mit gutem Schläger alle Steine weg (${T.ark ? T.ark.bricks.filter((k) => k.alive).length + ' übrig, ' + T.ark.phase : 'geschlossen'})`);
      run(1.7);
      ok(T.state === 'play' && !T.ark && !T.relic, 'danach zurück im Level, der C64 ist verbraucht');
      // verlieren: zweimal den Ball verlieren
      T.relic = { x: T.p.x + 60, y: 100, w: 16, h: 5 };
      clickAt(T.relic.x - T.cam.x + 8, T.relic.y + 14 + 2); release();
      run(0.4); tap('Space'); step();
      ok(T.ark.phase === 'play', 'Leertaste überspringt den C64-Startbildschirm');
      const drop = () => { T.ark.ball.stuck = 0; T.ark.ball.vx = 0; T.ark.ball.vy = 200; T.ark.ball.y = T.AF.y + T.AF.h - 2; step(); };
      drop();
      ok(T.ark.phase === 'play' && T.ark.balls === 1, 'erster Ball verloren: weiter mit dem zweiten');
      drop();
      ok(T.ark.phase === 'lost', 'zweiter Ball verloren: Ende');
      run(1.7);
      ok(T.state === 'play' && !T.ark, 'Arkanoid schließt sich');
      T.setState('title'); step();
    }

    console.log('Hall of Shame');
    T.setState('title'); step();
    clickAt(480 - 30, 7); release();
    ok(T.state === 'shame', 'Klick oben rechts im Titel öffnet die Hall of Shame');
    ok(['shame-kim88.jpg', 'shame-actionschnitzel.jpg'].every((f) => fs.existsSync(path.join(PUBLIC, f))), 'beide Bilder liegen in public/');
    run(0.6); tap('KeyX'); step();
    ok(T.state === 'title', 'beliebige Taste -> zurück ins Titelmenü');
    clickAt(480 - 30, 7); release(); run(0.6); clickAt(240, 135); release();
    ok(T.state === 'title', 'Mausklick -> zurück ins Titelmenü');

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
