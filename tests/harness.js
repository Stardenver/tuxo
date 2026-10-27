// Lädt das Spiel in Node: Canvas, DOM und Fenster sind Attrappen, gezeichnet wird ins Leere.
// Am Ende von game.js wird ein Zugang zu den internen Funktionen eingehängt (nur im Test).
'use strict';
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const noop = () => {};
const ctx2d = () => new Proxy({}, {
  get(t, k) {
    if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
    if (k === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
    return k in t ? t[k] : noop;
  },
  set(t, k, v) { t[k] = v; return true; },
});
const mkCanvas = () => ({ width: 0, height: 0, style: {}, getContext: ctx2d, addEventListener: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 480, height: 270 }) });
const handlers = {};

function load(apiBase) {
  global.window = global;
  global.document = {
    getElementById: (id) => (id === 'game' ? mkCanvas() : null), createElement: mkCanvas,
    addEventListener: noop, body: { classList: { add: noop, toggle: noop, remove: noop } }, hidden: false,
  };
  global.addEventListener = (n, f) => { (handlers[n] = handlers[n] || []).push(f); };
  global.innerWidth = 1440; global.innerHeight = 900;
  global.location = { hash: '', origin: 'https://example.org' };
  global.requestAnimationFrame = noop;
  global.localStorage = { getItem: () => null, setItem: noop };
  global.matchMedia = () => ({ matches: false });
  Object.defineProperty(global, 'navigator', { value: {}, configurable: true });
  if (apiBase) { const real = global.fetch; global.fetch = (u, o) => real(apiBase + u, o); }
  eval(fs.readFileSync(path.join(PUBLIC, 'levels.js'), 'utf8'));
  let src = fs.readFileSync(path.join(PUBLIC, 'game.js'), 'utf8');
  const hook = `window.__t = { update, draw, loadLevel, startGame, setState, keys, hit, mouse, ed, genLevel, checkRows,
    enterEditor, loadByCode, menuRects, ED_BUTTONS, TOOL_RECT, TOOLS,
    get p() { return p; }, get state() { return state; }, get mode() { return mode; }, get grid() { return grid; },
    get cam() { return cam; }, get shots() { return shots; }, get dyn() { return dyn; }, get chick() { return chick; },
    get score() { return score; }, get lives() { return lives; }, get curCode() { return curCode; },
    SPR, SKINS, get schnitzel() { return schnitzel; }, get schFx() { return schFx; },
    board, qualifies, finishGame, afterGameOver, set score(v) { score = v; }, get nm() { return nm; }, get run() { return run; },
    fromHash, get levelIdx() { return levelIdx; }, isCheater, get witch() { return witch; },
    explode, AF, get ark() { return ark; }, get relic() { return relic; }, set relic(v) { relic = v; },
    set forceC64(v) { forceC64 = v; }, pauseButtons,
    get lvlT() { return lvlT; }, set lvlT(v) { lvlT = v; }, get lastTimeBonus() { return lastTimeBonus; }, parTime,
    startCustom, get enemies() { return enemies; }, get pickups() { return pickups; },
    get laserReady() { return laserReady; }, get laserUsed() { return laserUsed; }, get beam() { return beam; } };
  requestAnimationFrame(frame);
})();`;
  const before = src;
  src = src.replace(/requestAnimationFrame\(frame\);\n\}\)\(\);\s*$/, hook);
  if (src === before) throw new Error('game.js: Ende der Datei hat sich geändert, Test-Zugang passt nicht mehr');
  eval(src);
  return window.__t;
}

const key = (code, down) => (handlers[down ? 'keydown' : 'keyup'] || []).forEach((f) => f({ code, key: /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : '', preventDefault: noop }));
module.exports = { load, key, PUBLIC };
