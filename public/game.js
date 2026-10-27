// T.U.X.O. – ein Höhlenabenteuer mit Tux, frei nach H.E.R.O. (C64)
'use strict';
(() => {
  const W = 480, H = 270, HUD = 14, TS = 16, ROWS = 16;
  const GRAV = 600, JET = 1150, STEP = 1 / 60;
  // Jetpack: Anlauf (pro s), Abbau beim Loslassen, Zusatzschub zum Abfangen im Fall, max. Fallgeschwindigkeit
  const SPOOL_UP = 10, SPOOL_DOWN = 4, BRAKE = 1.6, MAX_FALL = 260;
  const FUSE = 2.0, BLAST_R = 26;
  const cv = document.getElementById('game');
  const ctx = cv.getContext('2d');
  const LEVELS = window.TUXO_LEVELS;

  // ---------- Hilfsfunktionen ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rnd = (a, b) => a + Math.random() * (b - a);
  function hash(x, y, s) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  // Wertrauschen, optional periodisch (P) für kachelbare Muster
  function vnoise(x, y, s, P) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const w = (n) => (P ? ((n % P) + P) % P : n);
    const a = hash(w(xi), w(yi), s), b = hash(w(xi + 1), w(yi), s);
    const c = hash(w(xi), w(yi + 1), s), d = hash(w(xi + 1), w(yi + 1), s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* egal */ } },
  };

  // ---------- Pixelschrift 3x5 ----------
  const FONT = {
    A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
    F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
    K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
    P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
    U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
    Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
    4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111',
    9: '111101111001110', 'Ä': '101010101111101', 'Ö': '101000111101111', 'Ü': '101000101101111',
    '.': '000000000000010', ',': '000000000010100', ':': '000010000010000', '!': '010010010000010',
    '?': '110001010000010', '-': '000000111000000', '+': '000010111010000', '/': '001001010100100',
    '(': '010100100100010', ')': '010001001001010', "'": '010010000000000', '>': '100010001010100',
    '<': '001010100010001', '=': '000111000111000', '*': '101010101000000', '"': '101101000000000',
  };
  const textWidth = (s, sc = 1) => (s.length ? s.length * 4 * sc - sc : 0);
  function drawText(s, x, y, col, sc = 1, align = 'left', shadow = '#000') {
    s = String(s).toUpperCase().replace(/ß/g, 'SS');
    if (align === 'center') x -= Math.floor(textWidth(s, sc) / 2);
    else if (align === 'right') x -= textWidth(s, sc);
    x = Math.round(x); y = Math.round(y);
    if (shadow) drawRaw(s, x + sc, y + sc, shadow, sc);
    drawRaw(s, x, y, col, sc);
  }
  function drawRaw(s, x, y, col, sc) {
    ctx.fillStyle = col;
    for (let i = 0; i < s.length; i++) {
      const g = FONT[s[i]];
      if (g) for (let b = 0; b < 15; b++) if (g[b] === '1') ctx.fillRect(x + (b % 3) * sc, y + Math.floor(b / 3) * sc, sc, sc);
      x += 4 * sc;
    }
  }

  // ---------- Sprites ----------
  function sprite(rows, pal) {
    const w = Math.max(...rows.map((r) => r.length)), c = canvas(w, rows.length), g = c.getContext('2d');
    rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (pal[r[x]]) { g.fillStyle = pal[r[x]]; g.fillRect(x, y, 1, 1); } });
    return c;
  }
  function flip(c) {
    const f = canvas(c.width, c.height), g = f.getContext('2d');
    g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(c, 0, 0);
    return f;
  }
  // 1-Pixel-Kontur um alle deckenden Pixel (damit der schwarze Tux vor dunklem Hintergrund lesbar bleibt)
  function outlined(c, col) {
    const w = c.width, h = c.height, src = c.getContext('2d').getImageData(0, 0, w, h).data;
    const o = canvas(w, h), g = o.getContext('2d');
    g.fillStyle = col;
    const a = (x, y) => x >= 0 && y >= 0 && x < w && y < h && src[(y * w + x) * 4 + 3] > 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
      if (!a(x, y) && (a(x - 1, y) || a(x + 1, y) || a(x, y - 1) || a(x, y + 1))) g.fillRect(x, y, 1, 1);
    g.drawImage(c, 0, 0);
    return o;
  }
  function silhouette(c, col) {
    const s = canvas(c.width, c.height), g = s.getContext('2d');
    g.drawImage(c, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, c.width, c.height);
    return s;
  }
  const rot90 = (rows) => rows[0].split('').map((_, x) => rows.map((r) => r[x]).reverse().join(''));
  const pair = (c) => [c, flip(c)]; // [rechts, links]

  const TUX_PAL = { k: '#14141e', w: '#f4f4ee', y: '#f0a020', g: '#8a96a8', r: '#d83020' };
  const TUX_TOP = [
    '......kkkk......',
    '.....kkkkkk.....',
    '....kkkkkkkk....',
    '....kkkwwkwwk...',
    '....kkkwkkwkk...',
    '....kkkkyyyyy...',
    '....kkkkkyyyk...',
    '...kkkkkwwwwk...',
    '..ggkkkwwwwwwk..',
    '.gggkkwwwwwwwk..',
    '.grgkkwwwwwwwkk.',
    '.grgkwwwwwwwwkk.',
    '.gggkwwwwwwwwkk.',
    '.grgkwwwwwwwwk..',
    '.grgkwwwwwwwwk..',
    '.gggkwwwwwwwwk..',
    '..g.kkwwwwwwkk..',
    '....kkkwwwwkkk..',
    '.....kkkkkkkk...',
  ];
  const OUTLINE = '#7c86ac';
  const tuxSprite = (feet) => pair(outlined(sprite([...TUX_TOP, feet], TUX_PAL), OUTLINE));
  const SPR = {
    stand: tuxSprite('....yyyy..yyyy..'),
    walk: tuxSprite('...yyyy....yyyy.'),
    fly: tuxSprite('.....yyy..yyy...'),
    duck: pair(outlined(sprite([
      '......kkkk......',
      '.....kkkkkk.....',
      '....kkkwwkwwk...',
      '....kkkwkkwkk...',
      '..gggkkkyyyyy...',
      '.grgkkkkwwwwk...',
      '.gggkwwwwwwwwk..',
      '.grgkwwwwwwwwkk.',
      '.gggkkwwwwwwkkk.',
      '....kkkkkkkkkk..',
      '...yyyyy..yyyyy.',
    ], TUX_PAL), OUTLINE)),
  };
  SPR.hurt = SPR.stand.map((c) => silhouette(c, '#ffffff'));
  SPR.hurt2 = SPR.stand.map((c) => silhouette(c, '#ff4030'));
  SPR.life = outlined(sprite([
    '.kkkkk.',
    'kkwkwkk',
    'kkyyykk',
    'kwwwwwk',
    'kwwwwwk',
    '.kwwwk.',
    '.y...y.',
  ], TUX_PAL), OUTLINE);

  // Schnitzel-Modus (Easter Egg): gleiche Maße und Jetpack-Position wie Tux, damit Flamme und Hitbox passen
  const SCH_PAL = { k: '#14141e', o: '#c8641c', O: '#eea048', d: '#7a3410', l: '#f8d020', L: '#fff4a0', h: '#3aa03a',
    w: '#f4f4ee', g: '#8a96a8', r: '#d83020', n: '#3c3c4c', b: '#e0c060' };
  const SCH_TOP = [
    '.....h.h......n.',
    '....hhhh......n.',
    '...llhhll.....n.',
    '..lLLhLLlo....n.',
    '..lLlLlLlood..n.',
    '..lLLlLLloood.n.',
    '...lllllooOod.n.',
    '..ggdkkooookkonb',
    '.gggwwkoowwkownb',
    '.grgwkwoowkwwwn.',
    '.gggdoOoooOowwnn',
    '.grgdokwwwwkoknn',
    '.gggdowkwkwkokn.',
    '.grgdoOodoooOd..',
    '.grgdooOoodood..',
    '.gggkdoOooOodk..',
    '..g...doooood...',
    '.....kk...kk....',
    '.....kk...kk....',
  ];
  const schSprite = (feet) => pair(outlined(sprite([...SCH_TOP, feet], SCH_PAL), OUTLINE));
  const SKINS = {
    tux: { stand: SPR.stand, walk: SPR.walk, fly: SPR.fly, duck: SPR.duck, hurt: SPR.hurt, hurt2: SPR.hurt2, life: SPR.life },
    schnitzel: {
      stand: schSprite('....rrrr..rrrr..'),
      walk: schSprite('...rrrr....rrrr.'),
      fly: schSprite('.....rrr..rrr...'),
      duck: pair(outlined(sprite([
        '.....h.h........',
        '...lllhhl.......',
        '..lLlLhLlodd....',
        '..gglLLlooookd..',
        '.gggdkkookkokd..',
        '.grgwkwowkwowwnn',
        '.gggdoOoooOownnn',
        '.grgdokwwwkood..',
        '.gggdooOooOodd..',
        '....kdddddddk...',
        '...rrrrr..rrrrr.',
      ], SCH_PAL), OUTLINE)),
      life: outlined(sprite(['..h....', '.lloo..', 'lLooooo', 'owkowko', 'ooooooo', 'okwwwko', '.r...r.'], SCH_PAL), OUTLINE),
    },
  };
  SKINS.schnitzel.hurt = SKINS.schnitzel.stand.map((c) => silhouette(c, '#ffffff'));
  SKINS.schnitzel.hurt2 = SKINS.schnitzel.stand.map((c) => silhouette(c, '#ff4030'));

  const BAT_PAL = { m: '#a060d0', M: '#5e2c80', r: '#ff4848' };
  SPR.bat = [sprite([
    'm..............m',
    'mm............mm',
    '.mmm..M..M..mmm.',
    '..mmmMMMMMMmmm..',
    '....MMrMMrMM....',
    '.....MMMMMM.....',
    '......M..M......',
  ], BAT_PAL), sprite([
    '................',
    '................',
    '......M..M......',
    '....MMMMMMMM....',
    '..mmMMrMMrMMmm..',
    '.mmm.MMMMMM.mmm.',
    'mm....M..M....mm',
  ], BAT_PAL)];
  SPR.spider = sprite([
    '....pppp....',
    '...pppppp...',
    'p.ppyppypp.p',
    '.p.pppppp.p.',
    'pp.pppppp.pp',
    '..pppppppp..',
    '.p..pppp..p.',
    'p..p....p..p',
    '...p....p...',
    '..p......p..',
  ], { p: '#c84444', y: '#ffe040' });
  const BUG_PAL = { g: '#5cb84c', G: '#2c6a24', y: '#ffe040' };
  const BUG_TOP = ['....GGGGGG....', '...GgggggggG..', '..GggGggGggG..', '.yGgggggggggG.', 'yyGGGGGGGGGGG.'];
  SPR.bug = [
    pair(sprite([...BUG_TOP, '.G.G.G..G.G.G.', 'G..G..G..G..G.'], BUG_PAL)),
    pair(sprite([...BUG_TOP, 'G.G.G..G.G.G..', '.G..G..G..G..G'], BUG_PAL)),
  ];
  const TURRET = [
    '......ssssssss..',
    'bbbbbbsSSSSSSs..',
    '......sSrSSSSs..',
    '......sSSSSSSs..',
    '.......ssssss...',
    '.........ss.....',
    '.........ss.....',
    '.........ss.....',
    '.........ss.....',
    '.........ss.....',
    '.........ss.....',
    '.......ssssss...',
    '......sSSSSSSs..',
    '......sSSSSSSs..',
    '.....ssssssssss.',
    '.....ssssssssss.',
  ];
  const TPAL = { s: '#4a5a6a', S: '#8a9aaa', b: '#2a2a36' };
  // Index 0: schießt nach links, 1: nach rechts; jeweils [ruhig, lädt]
  SPR.turret = [
    [sprite(TURRET, { ...TPAL, r: '#702020' }), sprite(TURRET, { ...TPAL, r: '#ff7070' })],
  ];
  SPR.turret.push(SPR.turret[0].map(flip));
  const TROLL = [
    '.....hhhhh......',
    '....hhhhhhh.....',
    '....gggggggg....',
    '...ggwkggwkg....',
    '...gggggggggg...',
    '...ggkkkkkgg....',
    '....gggggggg....',
    '..bbbbbbbbbbbb..',
    '.gbbbbbbbbbbbbg.',
    '.gbbbbbbbbbbbbg.',
    '.g.bbbbbbbbbb.g.',
    '...bbbbbbbbbb...',
    '...bbbb..bbbb...',
    '...gg......gg...',
    '..ggg......ggg..',
  ];
  SPR.troll = pair(sprite(TROLL, { h: '#8a8a9a', g: '#5aa040', w: '#ffffff', k: '#000000', b: '#7a4a24' })).reverse();
  let axe = ['..hh....', '.hhhh...', '..ww....', '..ww....', '..ww....', '..ww....', '........', '........'];
  SPR.axe = [];
  for (let i = 0; i < 4; i++) { SPR.axe.push(sprite(axe, { h: '#c8c8d8', w: '#a06a30' })); axe = rot90(axe); }
  SPR.chick = sprite([
    '...GGGG...',
    '..GGGGGG..',
    '.GGkGGkGG.',
    '.GGGooGGG.',
    '.GGwwwwGG.',
    'GGwwwwwwGG',
    'GGwwwwwwGG',
    '.GwwwwwwG.',
    '..GGGGGG..',
    '..oo..oo..',
  ], { G: '#a4a4b8', w: '#f8f8f8', k: '#101010', o: '#f0a020' });
  SPR.gem = [sprite(['..ccc..', '.cCcCc.', 'cCcccCc', '.ccccc.', '..ccc..', '...c...'], { c: '#40c8f0', C: '#d0ffff' }),
    sprite(['..ccc..', '.cccCc.', 'ccccCcc', '.ccccc.', '..ccc..', '...c...'], { c: '#40c8f0', C: '#ffffff' })];
  SPR.dynPack = sprite([
    '..f..f..',
    '.f..f...',
    'rrrrrrr.',
    'rRrRrRr.',
    'wwwwwww.',
    'rRrRrRr.',
    'rRrRrRr.',
    'rrrrrrr.',
  ], { r: '#c02020', R: '#e85040', w: '#f0f0e0', f: '#d0b080' });
  SPR.dyn = sprite(['.f..', '..f.', 'rrrr', 'rRRr', 'wwww', 'rRRr', 'rRRr', 'rrrr'], { r: '#c02020', R: '#e85040', w: '#f0f0e0', f: '#d0b080' });
  SPR.dynIcon = sprite(['.f.', 'rrr', 'rRr', 'www', 'rRr', 'rrr'], { r: '#c02020', R: '#e85040', w: '#f0f0e0', f: '#d0b080' });

  // ---------- Ton (WebAudio, alles synthetisch) ----------
  const Sound = {
    ac: null, master: null, noiseBuf: null, jet: null,
    muted: store.get('tuxo-mute') === '1',
    init() {
      if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        const c = (this.ac = new AC());
        this.master = c.createGain();
        this.master.gain.value = this.muted ? 0 : 0.22;
        this.master.connect(c.destination);
        const len = c.sampleRate, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noiseBuf = b;
        // Jetpack: gefiltertes Rauschen + leises Brummen, Lautstärke folgt dem Schub
        const src = c.createBufferSource(); src.buffer = b; src.loop = true;
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.7;
        const g = c.createGain(); g.gain.value = 0;
        src.connect(bp); bp.connect(g); g.connect(this.master); src.start();
        const osc = c.createOscillator(); osc.type = 'square'; osc.frequency.value = 45;
        const og = c.createGain(); og.gain.value = 0;
        osc.connect(og); og.connect(this.master); osc.start();
        this.jet = { g, og, osc, bp };
      } catch (e) { this.ac = null; }
    },
    setJet(v) {
      if (!this.jet) return;
      const t = this.ac.currentTime;
      this.jet.g.gain.setTargetAtTime(v * 0.35, t, 0.04);
      this.jet.og.gain.setTargetAtTime(v * 0.05, t, 0.04);
      this.jet.osc.frequency.setTargetAtTime(40 + v * 25, t, 0.05);
      this.jet.bp.frequency.setTargetAtTime(500 + v * 600, t, 0.05);
    },
    tone(f, dur, o = {}) {
      if (!this.ac) return;
      const c = this.ac, t = c.currentTime + (o.delay || 0);
      const osc = c.createOscillator(), g = c.createGain();
      osc.type = o.type || 'square';
      osc.frequency.setValueAtTime(f, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
      g.gain.setValueAtTime(o.vol || 0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(g); g.connect(this.master);
      osc.start(t); osc.stop(t + dur + 0.02);
    },
    noise(dur, o = {}) {
      if (!this.ac) return;
      const c = this.ac, t = c.currentTime + (o.delay || 0);
      const src = c.createBufferSource(); src.buffer = this.noiseBuf;
      const f = c.createBiquadFilter(); f.type = o.type || 'lowpass';
      f.frequency.setValueAtTime(o.freq || 2000, t);
      if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(o.vol || 0.4, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
    },
    melody(notes, step, o = {}) { notes.forEach((n, i) => n && this.tone(n, step * 0.95, { ...o, delay: i * step })); },
    toggleMute() {
      this.muted = !this.muted;
      store.set('tuxo-mute', this.muted ? '1' : '0');
      if (this.master) this.master.gain.value = this.muted ? 0 : 0.22;
    },
  };
  const sfx = {
    drop: () => Sound.tone(260, 0.08, { to: 120, vol: 0.2 }),
    tick: () => Sound.noise(0.03, { vol: 0.07, freq: 5000, type: 'highpass' }),
    boom: () => { Sound.noise(0.9, { vol: 0.9, freq: 2400, to: 60 }); Sound.tone(80, 0.5, { to: 28, type: 'triangle', vol: 0.6 }); },
    crumble: () => Sound.noise(0.18, { vol: 0.25, freq: 900, to: 200 }),
    laser: () => Sound.tone(1500, 0.16, { to: 260, vol: 0.12 }),
    axe: () => Sound.tone(420, 0.12, { to: 800, type: 'triangle', vol: 0.2 }),
    pickup: () => Sound.melody([660, 990], 0.06, { vol: 0.18 }),
    gem: () => Sound.melody([880, 1175, 1480, 1760], 0.05, { vol: 0.15 }),
    kill: () => Sound.tone(300, 0.2, { to: 1000, vol: 0.18 }),
    die: () => { Sound.tone(700, 1.0, { to: 50, vol: 0.22 }); Sound.noise(0.3, { vol: 0.3, freq: 3000, to: 300 }); },
    clear: () => Sound.melody([523, 659, 784, 1047, 0, 784, 1047], 0.11, { vol: 0.2 }),
    tally: () => Sound.tone(1200, 0.03, { vol: 0.08 }),
    life: () => Sound.melody([523, 784, 1047, 1568], 0.08, { vol: 0.18, type: 'triangle' }),
    over: () => Sound.melody([392, 330, 262, 196], 0.28, { vol: 0.2, type: 'triangle' }),
    start: () => Sound.melody([262, 330, 392, 523], 0.08, { vol: 0.18 }),
  };

  // ---------- Eingabe ----------
  const keys = Object.create(null), hit = Object.create(null), typed = [];
  let inputSeen = false; // irgendeine Eingabe seit dem letzten Schritt (Titelmenü: Leerlauf zurücksetzen)
  const GAME_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter', 'KeyP', 'KeyM', 'Escape'];
  addEventListener('keydown', (e) => {
    if (GAME_KEYS.includes(e.code)) e.preventDefault();
    if ((state === 'codeinput' || state === 'nameentry') && e.code === 'Backspace') e.preventDefault();
    if (!keys[e.code]) hit[e.code] = true;
    keys[e.code] = true;
    inputSeen = true;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { hit.Undo = true; e.preventDefault(); }
    else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key && (e.key.length === 1 || e.key === 'Backspace')) typed.push(e.key);
    if (state === 'title' && e.key && e.key.length === 1) cheatKey(e.key.toUpperCase());
    Sound.init();
  });
  addEventListener('paste', (e) => {
    if (state !== 'codeinput') return;
    const c = findCode((e.clipboardData && e.clipboardData.getData('text')) || '');
    if (c) { codeBuf = c; codeErr = ''; e.preventDefault(); }
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  const releaseAll = () => { for (const k in keys) keys[k] = false; };
  addEventListener('blur', () => { releaseAll(); if (state === 'play') paused = true; });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') paused = true; });
  const consume = (...codes) => { let v = false; for (const c of codes) { if (hit[c]) v = true; hit[c] = false; } return v; };
  const K = {
    left: () => keys.ArrowLeft || keys.KeyA,
    right: () => keys.ArrowRight || keys.KeyD,
    up: () => keys.ArrowUp || keys.KeyW,
    down: () => keys.ArrowDown || keys.KeyS,
  };

  // Touch-Steuerung (nur auf Geräten mit Touchscreen sichtbar)
  const touchUI = document.getElementById('touch');
  const isTouch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  if (touchUI && isTouch) {
    document.body.classList.add('touch');
    touchUI.querySelectorAll('[data-key]').forEach((b) => {
      const code = b.dataset.key;
      const on = (e) => { e.preventDefault(); Sound.init(); if (!keys[code]) hit[code] = true; keys[code] = true; inputSeen = true; b.classList.add('on'); };
      const off = (e) => { e.preventDefault(); keys[code] = false; b.classList.remove('on'); };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('pointerleave', off);
    });
  }
  // Maus (und Finger): Position in Spielkoordinaten, Klicks werden pro Schritt ausgewertet
  const mouse = { x: -1, y: -1, down: false, button: 0, clicked: false, rclicked: false, wheel: 0, moved: false };
  function toGame(e) {
    const r = cv.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) * W) / r.width;
    mouse.y = ((e.clientY - r.top) * H) / r.height;
  }
  cv.addEventListener('pointerdown', (e) => {
    Sound.init(); toGame(e); inputSeen = true;
    mouse.down = true; mouse.button = e.button;
    if (e.button === 2) mouse.rclicked = true; else mouse.clicked = true;
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
  });
  cv.addEventListener('pointermove', (e) => { toGame(e); mouse.moved = true; inputSeen = true; });
  cv.addEventListener('pointerup', () => { mouse.down = false; });
  cv.addEventListener('pointercancel', () => { mouse.down = false; });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('wheel', (e) => {
    if (state !== 'editor') return;
    e.preventDefault();
    mouse.wheel += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  }, { passive: false });

  // ---------- Grafik der Höhle ----------
  const ROCK = ['#3e240f', '#5c3818', '#7a4c22', '#96622e', '#b88044', '#d8a868'].map(hex);
  const MOSS = ['#3a7428', '#5a9a34'].map(hex);
  const STONE = ['#2e2e3a', '#5a5a6c', '#76768a', '#9494a8', '#b8b8ca'].map(hex);
  const WOOD = ['#2e1a0c', '#6a3c1a', '#844c22', '#a0602c'].map(hex);
  const IRON = ['#24242e', '#55556a', '#a8a8bc'].map(hex);
  const LAVA = ['#6a120a', '#b0280e', '#e0521a', '#ff9020', '#ffd050', '#fff4a0'].map(hex);
  const BG = ['#1a1022', '#22152c', '#2a1b36', '#332241'].map(hex);

  const SOLID = { '#': 1, X: 1, D: 1, L: 1 };
  let grid = [], lvlW = 0, levelCv = null, levelCtx = null, lavaTiles = [], segStarts = [];
  const tileAt = (tx, ty) => (ty < 0 || ty >= ROWS || tx < 0 || tx >= lvlW ? '#' : grid[ty][tx]);
  const solidAt = (tx, ty) => !!SOLID[tileAt(tx, ty)];
  function rectTiles(x, y, w, h, fn) {
    const x0 = Math.floor(x / TS), x1 = Math.floor((x + w - 0.001) / TS);
    const y0 = Math.floor(y / TS), y1 = Math.floor((y + h - 0.001) / TS);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (fn(tileAt(tx, ty), tx, ty)) return true;
    return false;
  }
  const rectSolid = (x, y, w, h) => rectTiles(x, y, w, h, (t) => SOLID[t]);

  function tilePixel(t, tx, ty, lx, ly) {
    const px = tx * TS + lx, py = ty * TS + ly;
    if (t === '#') {
      const up = solidAt(tx, ty - 1), dn = solidAt(tx, ty + 1), lf = solidAt(tx - 1, ty), rt = solidAt(tx + 1, ty);
      // abgerundete Außenecken
      if ((!up && !lf && lx + ly < 2) || (!up && !rt && 15 - lx + ly < 2) ||
          (!dn && !lf && lx + 15 - ly < 2) || (!dn && !rt && 30 - lx - ly < 2)) return null;
      const n = vnoise(px / 6, py / 6, 11) * 0.65 + vnoise(px / 2.5, py / 2.5, 12) * 0.35;
      let i = n < 0.34 ? 1 : n < 0.5 ? 2 : n < 0.66 ? 3 : 4;
      const h = hash(px, py, 13);
      if (h < 0.05) i = Math.max(0, i - 2); else if (h > 0.975) i = 5;
      if (!up) {
        const moss = hash(px, 7, 14);
        if (moss < 0.55 && ly < 1 + Math.floor(moss * 7)) return MOSS[(px + ly) % 2];
        if (ly === 0) i = 5; else if (ly === 1) i = Math.max(i, 4);
      }
      if (!dn && ly >= 14) i = ly === 15 ? 0 : Math.min(i, 1);
      if ((!lf && lx === 0) || (!rt && lx === 15)) i = Math.max(0, i - 2);
      return ROCK[i];
    }
    if (t === 'X') {
      const same = (a, b) => tileAt(a, b) === 'X';
      if ((!same(tx, ty - 1) && ly === 0) || (!same(tx, ty + 1) && ly === 15) ||
          (!same(tx - 1, ty) && lx === 0) || (!same(tx + 1, ty) && lx === 15)) return STONE[0];
      const row = Math.floor(py / 4), off = (row % 2) * 4;
      let i = hash(Math.floor((px + off) / 8), row, 21) < 0.5 ? 2 : 3;
      if (py % 4 === 3 || (px + off) % 8 === 7) i = 1;
      else if (py % 4 === 0) i = 4;
      const crack = 8 + Math.round(Math.sin(py * 0.7 + tx * 3.1) * 2.5 + Math.sin(py * 0.23 + ty) * 2);
      if (lx === crack || (lx === crack + 1 && py % 3 === 0)) i = 0;
      return STONE[i];
    }
    if (t === 'D') {
      const same = (a, b) => tileAt(a, b) === 'D';
      if ((!same(tx - 1, ty) && lx === 0) || (!same(tx + 1, ty) && lx === 15)) return IRON[0];
      if (!same(tx, ty - 1) && ly <= 1) return ly === 0 ? IRON[0] : IRON[1];
      if (!same(tx, ty + 1) && ly === 15) return IRON[0];
      if (ly === 3 || ly === 11) return lx % 5 === 2 ? IRON[2] : IRON[1];
      if (ly === 4 || ly === 12) return IRON[0];
      if (px % 4 === 0) return WOOD[0];
      const plank = Math.floor(px / 4);
      return WOOD[Math.min(3, 1 + (plank % 2) + (hash(px, py, 32) < 0.08 ? 1 : 0))];
    }
    if (t === 'L') return LAVA[1];
    return null;
  }

  function renderTiles(x0, y0, x1, y1) {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(lvlW - 1, x1); y1 = Math.min(ROWS - 1, y1);
    const w = (x1 - x0 + 1) * TS, h = (y1 - y0 + 1) * TS;
    const img = levelCtx.createImageData(w, h), d = img.data;
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const t = grid[ty][tx];
      if (!SOLID[t]) continue;
      for (let ly = 0; ly < TS; ly++) for (let lx = 0; lx < TS; lx++) {
        const c = tilePixel(t, tx, ty, lx, ly);
        if (!c) continue;
        const o = (((ty - y0) * TS + ly) * w + (tx - x0) * TS + lx) * 4;
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
      }
    }
    levelCtx.putImageData(img, x0 * TS, y0 * TS);
  }

  // Lava: 8 Animationsphasen, vertikal über 2 Kacheln nahtlos
  const lavaFrames = [0, 1].map((v) => Array.from({ length: 8 }, (_, f) => {
    const c = canvas(TS, TS), g = c.getContext('2d'), img = g.createImageData(TS, TS);
    for (let ly = 0; ly < TS; ly++) for (let lx = 0; lx < TS; lx++) {
      const y = ly + v * TS, P2 = Math.PI * 2;
      const a = Math.sin(P2 * (y + f * 4) / 32 + 1.6 * Math.sin(P2 * lx / 16));
      const b = Math.sin(P2 * lx / 16 - P2 * (y + f * 4) / 16);
      const n = 0.5 + 0.3 * a + 0.2 * b;
      const col = LAVA[n < 0.22 ? 1 : n < 0.45 ? 2 : n < 0.68 ? 3 : n < 0.86 ? 4 : 5];
      const o = (ly * TS + lx) * 4;
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }));

  // Höhlenrückwand, kachelbar 64x64
  const bgTile = (() => {
    const c = canvas(64, 64), g = c.getContext('2d'), img = g.createImageData(64, 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const n = vnoise(x / 8, y / 8, 41, 8) * 0.7 + vnoise(x / 4, y / 4, 42, 16) * 0.3;
      let i = n < 0.38 ? 0 : n < 0.55 ? 1 : n < 0.7 ? 2 : 3;
      if (i === 3 && hash(x, y, 43) < 0.5) i = 2;
      const col = BG[i], o = (y * 64 + x) * 4;
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  })();

  // ---------- Spielzustand ----------
  let state = 'title', paused = false, stateT = 0, time = 0;
  let mode = 'campaign', curLevel = null, curRows = null, curCode = ''; // mode: campaign | test | custom
  let levelIdx = 0, round = 0, score = 0, lives = 3, nextLife = 20000;
  let hiscore = parseInt(store.get('tuxo-hiscore') || '0', 10) || 0;
  let p, cam, enemies, shots, pickups, hints, dyn, particles, crumbles, chick, shake, flash, popups, respawn, checkpoint, tally;
  // Zeitwertung: Sollzeit 0,8 s pro Spalte, jede Sekunde darunter bringt TIME_PTS Punkte
  let lvlT = 0, lastTimeBonus = 0;
  // Überraschung: nach einem Edelstein einmal pro Level ein Laser mit Shift (keine Anzeige, kein Hinweis)
  let laserReady = false, laserUsed = false, beam = null;
  // Easter Egg: selten ersetzt ein C64-Android einen Laufgegner; besiegt bleibt ein C64 liegen (Klick = Arkanoid)
  const C64_CHANCE = 0.15;
  let relic = null, forceC64 = false, ark = null;
  const PAR_PER_COL = 0.8, TIME_PTS = 20;
  const parTime = () => Math.round(lvlW * PAR_PER_COL);
  const clock = (sec) => { const t = Math.floor(sec); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  const START_DYN = 6, MAX_DYN = 9;
  const FUEL_BURN = 2.0; // Tankinhalt (100) pro Sekunde bei vollem Schub
  // Fallschaden: bis FALL_SAFE px Fallhöhe nichts, darüber FALL_DMG Energie pro px (gleich, ob Tank leer oder losgelassen)
  const FALL_SAFE = 6 * TS, FALL_DMG = 0.4;

  function newPlayer(x, y) {
    return { x, y, w: 10, h: 19, vx: 0, vy: 0, face: 1, onGround: false, duck: false, spool: 0, thrusting: false,
      anim: 0, energy: 100, fuel: 100, fallTop: y, dyn: START_DYN, inv: 0 };
  }

  function loadLevel(i) { loadLevelData(LEVELS[i % LEVELS.length]); }
  function loadLevelData(L) {
    curLevel = L;
    grid = [];
    for (let r = 0; r < ROWS; r++) grid.push(L.segments.map((s) => s[r]).join('').split(''));
    lvlW = grid[0].length;
    segStarts = [];
    let acc = 0;
    for (const s of L.segments) { segStarts.push(acc); acc += s[0].length; }
    enemies = []; shots = []; pickups = []; hints = []; particles = []; crumbles = []; popups = [];
    dyn = null; chick = null; shake = 0; flash = 0; lvlT = 0;
    laserReady = laserUsed = false; beam = null;
    const speed = 1 + round * 0.25;
    let start = null;
    for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < lvlW; tx++) {
      const ch = grid[ty][tx], x = tx * TS;
      if (SOLID[ch] || ch === '.') continue;
      grid[ty][tx] = '.';
      let y = ty * TS;
      // Bodengegner stehen immer auf dem nächsten Boden darunter
      if ('wTRA'.includes(ch)) { let g = ty; while (g < ROWS - 1 && !SOLID[grid[g + 1][tx]]) g++; y = g * TS; }
      if (ch === 'P') start = { x: x + 3, y: y + TS - 19 };
      else if (ch === 'C') chick = { x: x + 3, y: y + TS - 10, w: 10, h: 10, saved: false };
      else if (ch === '+') pickups.push({ kind: 'dyn', x: x + 4, y: y + 8, w: 8, h: 8 });
      else if (ch === '*') pickups.push({ kind: 'gem', x: x + 4, y: y + 6, w: 7, h: 6 });
      else if (ch >= '1' && ch <= '9') hints.push({ x: x + 8, y: y + 8, text: L.hints[ch] || '' });
      else if (ch === 'b') enemies.push({ kind: 'bat', x: x + 1, y: y + 4, w: 14, h: 7, hx: x, by: y + 4, vx: 38 * speed, t: Math.random() * 6, pts: 50 });
      else if (ch === 's') enemies.push({ kind: 'spider', x: x + 2, y, w: 12, h: 10, ay: y, dir: 1, wait: 0, speed, pts: 75 });
      else if (ch === 'w') enemies.push({ kind: 'bug', x: x + 1, y: y + TS - 7, w: 14, h: 7, vx: -24 * speed, t: 0, pts: 50 });
      else if (ch === 'T' || ch === 'R') enemies.push({ kind: 'turret', x: x + 1, y, w: 14, h: 16, dir: ch === 'T' ? -1 : 1,
        cool: 0.8 + Math.random(), charge: 0, period: 1.7 / speed, pts: 150 });
      else if (ch === 'A') enemies.push({ kind: 'troll', x: x + 1, y: y + 1, w: 14, h: 15, dir: -1,
        cool: 1 + Math.random(), charge: 0, period: 2.0 / speed, pts: 200 });
    }
    // Spinnen: Faden reicht bis 6 Kacheln oder bis zum Boden
    for (const e of enemies) if (e.kind === 'spider') {
      let n = 1;
      while (n < 6 && !solidAt(Math.floor((e.x + 6) / TS), Math.floor(e.ay / TS) + n)) n++;
      e.maxY = e.ay + n * TS - e.h - 2;
      e.y = e.ay + Math.random() * (e.maxY - e.ay);
    }
    // C64-Android: übernimmt Platz und Punkte eines Käfers oder Trolls, braucht aber zwei Sprengungen
    relic = null;
    const spots = enemies.filter((e) => (e.kind === 'bug' || e.kind === 'troll') && !rectSolid(e.x, e.y + e.h - 15, 14, 15));
    if (spots.length && mode !== 'test' && (forceC64 || Math.random() < C64_CHANCE)) {
      const e = pick(spots);
      Object.assign(e, { kind: 'c64', y: e.y + e.h - 15, w: 14, h: 15, vx: -18 * speed, t: 0, hp: 2, hurt: 0 });
    }
    forceC64 = false;
    lavaTiles = [];
    for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < lvlW; tx++) if (grid[ty][tx] === 'L') lavaTiles.push([tx, ty]);
    levelCv = canvas(lvlW * TS, ROWS * TS);
    levelCtx = levelCv.getContext('2d');
    renderTiles(0, 0, lvlW - 1, ROWS - 1);
    p = newPlayer(start.x, start.y);
    cam = { x: clamp(p.x - 120, 0, lvlW * TS - W) };
    respawn = { x: start.x, y: start.y };
    checkpoint = 0;
  }

  function startGame() {
    mode = 'campaign';
    score = 0; lives = 3; round = 0; levelIdx = 0; nextLife = 20000; p = null;
    loadLevel(0);
    setState('intro');
    sfx.start();
    startRun();
  }
  function setState(s) {
    state = s; stateT = 0; paused = false;
    for (const k in hit) hit[k] = false;
    document.body.classList.toggle('editing', s === 'editor' || s === 'share');
    document.body.classList.toggle('shame', s === 'shame');
  }

  function addScore(n, x, y) {
    score += n;
    if (x !== undefined) popups.push({ x, y, text: String(n), t: 0 });
    if (score >= nextLife) { nextLife += 20000; lives = Math.min(lives + 1, 9); sfx.life(); if (x !== undefined) popups.push({ x, y: y - 10, text: 'EXTRALEBEN!', t: 0 }); }
  }

  function burst(x, y, n, colors, o = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = rnd(o.min || 20, o.max || 120);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (o.up || 0), life: rnd(0.3, o.life || 0.9), t: 0,
        col: colors[(Math.random() * colors.length) | 0], g: o.g === undefined ? 300 : o.g, size: o.size || 1 });
    }
  }

  // ---------- Spieler ----------
  function moveBody(b, dx, dy) {
    b.hitWall = false;
    if (dx) {
      b.x += dx;
      if (rectSolid(b.x, b.y, b.w, b.h)) {
        b.x = dx > 0 ? Math.floor((b.x + b.w) / TS) * TS - b.w - 0.01 : (Math.floor(b.x / TS) + 1) * TS + 0.01;
        b.vx = 0; b.hitWall = true;
      }
    }
    if (dy) {
      b.y += dy;
      if (rectSolid(b.x, b.y, b.w, b.h)) {
        b.y = dy > 0 ? Math.floor((b.y + b.h) / TS) * TS - b.h - 0.01 : (Math.floor(b.y / TS) + 1) * TS + 0.01;
        b.vy = 0;
      }
    }
  }

  function updatePlayer(dt) {
    const L = K.left(), R = K.right(), U = K.up(), D = K.down();
    // Ducken nur am Boden
    const wantDuck = p.onGround && D && !U;
    if (wantDuck && !p.duck) { p.duck = true; p.y += 8; p.h = 11; }
    else if (!wantDuck && p.duck && !rectSolid(p.x, p.y - 8, p.w, 19)) { p.duck = false; p.y -= 8; p.h = 19; }

    const dir = (R ? 1 : 0) - (L ? 1 : 0);
    if (dir) p.face = dir;
    const target = p.duck ? 0 : dir * (p.onGround ? 80 : 92);
    const acc = p.onGround ? 900 : 520;
    p.vx = p.vx < target ? Math.min(target, p.vx + acc * dt) : Math.max(target, p.vx - acc * dt);

    // Jetpack: Schub läuft kurz an, wie der Rotor beim Original
    p.thrusting = U && !p.duck && p.fuel > 0;
    p.spool = p.thrusting ? Math.min(1, p.spool + dt * SPOOL_UP) : Math.max(0, p.spool - dt * SPOOL_DOWN);
    const thrust = p.thrusting ? JET * p.spool * (p.vy > 0 ? BRAKE : 1) : 0;
    p.vy = clamp(p.vy + (GRAV - thrust) * dt, -150, MAX_FALL);

    const landing = p.vy > 0;
    moveBody(p, p.vx * dt, p.vy * dt);
    p.onGround = rectSolid(p.x, p.y + p.h + 0.02, p.w, 0.5);
    if (p.onGround && landing && p.vy === 0 && p.fallSpeed > 160) burst(p.x + 5, p.y + p.h, 4, ['#8a6a4a', '#6a5040'], { max: 40, g: 200, life: 0.4 });
    p.fallSpeed = p.vy;
    // Fallhöhe: zählt ab dem Punkt, an dem Tux zuletzt (fast) stand oder schwebte – Abbremsen mit dem Jetpack setzt sie zurück
    if (p.onGround || p.vy < 60) {
      const h = p.y - p.fallTop;
      if (p.onGround && h > FALL_SAFE) {
        const dmg = Math.round((h - FALL_SAFE) * FALL_DMG);
        p.energy = Math.max(0, p.energy - dmg);
        Sound.tone(160, 0.25, { to: 60, type: 'triangle', vol: 0.25 });
        shake = Math.max(shake, 0.15);
        popups.push({ x: p.x + p.w / 2, y: p.y - 6, text: 'AUA! -' + dmg, t: 0 });
        if (p.energy <= 0) { p.fallTop = p.y; die('ZU TIEF GEFALLEN'); return; }
      }
      p.fallTop = p.y;
    }

    // Nur innerhalb des sichtbaren Bereichs nach links
    if (p.x < cam.x + 1) { p.x = cam.x + 1; if (p.vx < 0) p.vx = 0; }
    p.anim += dt * (Math.abs(p.vx) > 5 && p.onGround ? 1 : 0);

    if (p.thrusting && p.spool > 0.4 && Math.random() < 0.5) {
      const nx = p.face > 0 ? p.x - 1 : p.x + p.w + 1;
      particles.push({ x: nx, y: p.y + p.h - 1, vx: rnd(-10, 10), vy: rnd(40, 80), life: rnd(0.15, 0.35), t: 0,
        col: ['#ffe060', '#ff9020', '#d04010', '#777788'][(Math.random() * 4) | 0], g: -40, size: 1 });
    }
    Sound.setJet(state === 'play' && !paused && p.thrusting ? 0.4 + p.spool * 0.6 : 0);

    // Dynamit
    if (consume('Space') && !dyn && p.dyn > 0) {
      p.dyn--;
      dyn = { x: p.x + p.w / 2 - 2, y: p.y + p.h - 8, w: 4, h: 8, vy: Math.max(0, p.vy * 0.3), t: FUSE, tick: 0 };
      sfx.drop();
    }

    // Treibstoff: nur das Jetpack verbraucht ihn, je nach Schub. Leer geht das Jetpack einfach nicht mehr
    if (p.thrusting) p.fuel = Math.max(0, p.fuel - dt * FUEL_BURN * (0.3 + 0.7 * p.spool) * (1 + round * 0.1));
    if (p.fuel <= 0 && !p.empty) {
      p.empty = true;
      Sound.tone(220, 0.5, { to: 60, type: 'sawtooth', vol: 0.15 });
      popups.push({ x: p.x + p.w / 2, y: p.y - 6, text: 'TANK LEER!', t: 0 });
    }

    // Lava
    if (rectTiles(p.x - 1, p.y - 1, p.w + 2, p.h + 2, (t) => t === 'L')) { die(); return; }

    // Rücksetzpunkt beim Betreten eines neuen Abschnitts (nur auf sicherem Boden)
    const seg = segIndex(p.x + p.w / 2);
    if (p.onGround && !p.duck && seg > checkpoint) { checkpoint = seg; respawn = { x: p.x, y: p.y }; }

    if (p.inv > 0) p.inv -= dt;
  }
  function segIndex(x) { let i = 0; while (i + 1 < segStarts.length && x >= segStarts[i + 1] * TS + 8) i++; return i; }

  function die(reason) {
    if (state !== 'play') return;
    sfx.die();
    Sound.setJet(0);
    burst(p.x + 5, p.y + p.h / 2, 30, ['#ffffff', '#14141e', '#f0a020', '#7c86ac'], { max: 140, up: 60 });
    shake = 0.3;
    p.deathReason = reason || '';
    setState('dying');
  }

  // ---------- Dynamit & Explosion ----------
  function updateDynamite(dt) {
    if (!dyn) return;
    dyn.vy = Math.min(dyn.vy + GRAV * dt, 300);
    moveBody(dyn, 0, dyn.vy * dt);
    dyn.t -= dt;
    dyn.tick -= dt;
    if (dyn.tick <= 0) { dyn.tick = 0.12; sfx.tick(); }
    if (Math.random() < 0.6) particles.push({ x: dyn.x + 1, y: dyn.y, vx: rnd(-25, 25), vy: rnd(-50, -10), life: 0.25, t: 0,
      col: Math.random() < 0.5 ? '#ffffa0' : '#ffb020', g: 200, size: 1 });
    if (dyn.t <= 0) { explode(dyn.x + 2, dyn.y + 4); dyn = null; }
  }

  function explode(cx, cy) {
    sfx.boom();
    shake = 0.45; flash = 0.12;
    burst(cx, cy, 40, ['#ffffff', '#fff4a0', '#ffd050', '#ff9020', '#e0521a'], { max: 160, g: 60, life: 0.6, size: 2 });
    burst(cx, cy, 18, ['#555566', '#777788', '#3a3a44'], { max: 50, g: -30, life: 1.2, size: 2 });
    // Sprengbare Kacheln im Radius; ganze zusammenhängende Wand bröckelt nacheinander weg
    const r = BLAST_R;
    for (let ty = Math.floor((cy - r) / TS); ty <= Math.floor((cy + r) / TS); ty++)
      for (let tx = Math.floor((cx - r) / TS); tx <= Math.floor((cx + r) / TS); tx++) {
        const t = tileAt(tx, ty);
        if (t !== 'X' && t !== 'D') continue;
        const nx = clamp(cx, tx * TS, tx * TS + TS), ny = clamp(cy, ty * TS, ty * TS + TS);
        if (Math.hypot(nx - cx, ny - cy) <= r) crumbleFrom(tx, ty);
      }
    for (const e of enemies) {
      if (e.dead) continue;
      const nx = clamp(cx, e.x, e.x + e.w), ny = clamp(cy, e.y, e.y + e.h);
      if (Math.hypot(nx - cx, ny - cy) <= r + 10) hitEnemy(e);
    }
    if (state === 'play' && p.inv <= 0) {
      const nx = clamp(cx, p.x, p.x + p.w), ny = clamp(cy, p.y, p.y + p.h);
      if (Math.hypot(nx - cx, ny - cy) <= r - 4) die('ZU NAH AM DYNAMIT');
    }
  }

  function crumbleFrom(sx, sy) {
    const type = tileAt(sx, sy), seen = new Set([sx + ',' + sy]), q = [[sx, sy, 0]];
    let points = 0;
    while (q.length) {
      const [tx, ty, d] = q.shift();
      if (crumbles.some((c) => c.tx === tx && c.ty === ty)) continue;
      crumbles.push({ tx, ty, t: d * 0.05, type });
      points++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = tx + dx, ny = ty + dy, k = nx + ',' + ny;
        if (!seen.has(k) && tileAt(nx, ny) === type) { seen.add(k); q.push([nx, ny, d + 1]); }
      }
    }
    if (points) addScore(type === 'D' ? 100 : 75, sx * TS + 8, sy * TS);
  }

  function updateCrumbles(dt) {
    for (let i = crumbles.length - 1; i >= 0; i--) {
      const c = crumbles[i];
      c.t -= dt;
      if (c.t > 0) continue;
      crumbles.splice(i, 1);
      if (grid[c.ty][c.tx] !== c.type) continue;
      grid[c.ty][c.tx] = '.';
      renderTiles(c.tx - 1, c.ty - 1, c.tx + 1, c.ty + 1);
      const cols = c.type === 'D' ? ['#844c22', '#6a3c1a', '#55556a'] : ['#76768a', '#9494a8', '#5a5a6c'];
      burst(c.tx * TS + 8, c.ty * TS + 8, 8, cols, { max: 90, up: 40, size: 2, life: 0.8 });
      if (Math.random() < 0.5) sfx.crumble();
    }
  }

  // ---------- Laser ----------
  function fireLaser() {
    if (!laserReady || laserUsed) return;
    laserReady = false; laserUsed = true;
    const dir = p.face > 0 ? 1 : -1, y = p.y + (p.duck ? 4 : 8), ty = Math.floor(y / TS);
    const x0 = dir > 0 ? p.x + p.w : p.x;
    const edge = dir > 0 ? cam.x + W : cam.x;
    let x1 = edge, hitWall = false;
    for (let tx = Math.floor(x0 / TS); dir > 0 ? tx * TS < edge : (tx + 1) * TS > edge; tx += dir) {
      if (SOLID[tileAt(tx, ty)]) { x1 = dir > 0 ? Math.max(x0, tx * TS) : Math.min(x0, (tx + 1) * TS); hitWall = true; break; }
    }
    const a = Math.min(x0, x1), b = Math.max(x0, x1);
    for (const e of enemies) if (!e.dead && e.x < b && e.x + e.w > a && e.y <= y + 1 && e.y + e.h >= y - 1) hitEnemy(e);
    beam = { x0, x1, y, t: 0 };
    if (hitWall) burst(x1, y, 14, ['#ffffff', '#a0f0ff', '#40c8f0'], { max: 90, life: 0.5 });
    shake = Math.max(shake, 0.12);
    Sound.tone(2400, 0.4, { to: 160, type: 'sawtooth', vol: 0.16 });
    Sound.noise(0.25, { vol: 0.2, freq: 6000, to: 800, type: 'highpass' });
  }

  // ---------- Gegner ----------
  function hitEnemy(e) {
    if (e.kind === 'c64' && --e.hp > 0) {
      e.hurt = 0.5;
      Sound.melody([1200, 600, 1200, 300], 0.05, { vol: 0.15 });
      popups.push({ x: e.x + e.w / 2, y: e.y - 4, text: 'BZZT!', t: 0 });
      burst(e.x + e.w / 2, e.y + 4, 12, ['#6c5eb5', '#ffffff', '#ffe040'], { max: 90, up: 40 });
      return;
    }
    killEnemy(e);
  }
  function killEnemy(e) {
    e.dead = true;
    sfx.kill();
    addScore(e.pts, e.x + e.w / 2, e.y);
    const cols = { bat: ['#a060d0', '#5e2c80'], spider: ['#c84444', '#ffe040'], bug: ['#5cb84c', '#2c6a24'],
      turret: ['#8a9aaa', '#4a5a6a', '#ff7070'], troll: ['#5aa040', '#7a4a24'], c64: ['#c8c0a8', '#6c5eb5', '#a89878'] }[e.kind];
    burst(e.x + e.w / 2, e.y + e.h / 2, 16, cols, { max: 110, up: 50, size: 2 });
    if (e.kind === 'c64') relic = { x: e.x - 1, y: e.y + e.h - 5, w: 16, h: 5 }; // übrig bleibt der Brotkasten
  }

  function lineClear(x0, x1, y) {
    const a = Math.floor(Math.min(x0, x1) / TS), b = Math.floor(Math.max(x0, x1) / TS), ty = Math.floor(y / TS);
    for (let tx = a; tx <= b; tx++) if (solidAt(tx, ty)) return false;
    return true;
  }

  function updateEnemies(dt) {
    const onScreen = (e) => e.x + e.w > cam.x - 8 && e.x < cam.x + W + 8;
    for (const e of enemies) {
      if (e.dead) continue;
      if (e.kind === 'bat') {
        e.t += dt;
        e.x += e.vx * dt;
        if (rectSolid(e.x, e.y, e.w, e.h) || Math.abs(e.x - e.hx) > 72) { e.x -= e.vx * dt; e.vx = -e.vx; }
        const ny = e.by + Math.sin(e.t * 3) * 7;
        if (!rectSolid(e.x, ny, e.w, e.h)) e.y = ny;
      } else if (e.kind === 'spider') {
        if (e.wait > 0) { e.wait -= dt; continue; }
        e.y += e.dir * (e.dir > 0 ? 34 : 24) * e.speed * dt;
        if (e.y >= e.maxY) { e.y = e.maxY; e.dir = -1; e.wait = 0.5; }
        if (e.y <= e.ay) { e.y = e.ay; e.dir = 1; e.wait = 0.9; }
      } else if (e.kind === 'bug' || e.kind === 'c64') {
        if (e.hurt > 0) e.hurt -= dt;
        e.t += dt;
        e.x += e.vx * dt;
        const front = e.vx > 0 ? e.x + e.w : e.x - 1;
        if (rectSolid(e.x, e.y, e.w, e.h) || !solidAt(Math.floor(front / TS), Math.floor((e.y + e.h + 2) / TS))) {
          e.x -= e.vx * dt; e.vx = -e.vx;
        }
      } else if (e.kind === 'turret' || e.kind === 'troll') {
        const floor = e.kind === 'turret' ? e.y + TS : e.y + 15;
        if (e.kind === 'troll') e.dir = p.x + p.w / 2 < e.x + e.w / 2 ? -1 : 1;
        const by = floor - 15;
        const px = p.x + p.w / 2, ex = e.x + e.w / 2;
        const sees = state === 'play' && onScreen(e) && (px - ex) * e.dir > 0 && Math.abs(px - ex) < 280 &&
          p.y < floor && p.y + p.h > floor - 48 && lineClear(ex, px, by);
        if (e.charge > 0) {
          e.charge -= dt;
          if (e.charge <= 0) fire(e, by);
        } else {
          e.cool -= dt;
          if (e.cool <= 0 && sees) e.charge = 0.35;
        }
      }
      if (state === 'play' && p.inv <= 0) {
        const hb = { x: e.x + 2, y: e.y + 2, w: e.w - 4, h: e.h - 3 };
        if (overlap(p, hb)) die();
      }
    }
  }

  function fire(e, by) {
    e.cool = e.period;
    if (e.kind === 'turret') {
      shots.push({ kind: 'laser', x: e.dir < 0 ? e.x - 8 : e.x + e.w, y: by - 1.5, w: 10, h: 3, vx: 170 * e.dir * (1 + round * 0.15) });
      sfx.laser();
    } else {
      shots.push({ kind: 'axe', x: e.dir < 0 ? e.x - 6 : e.x + e.w, y: by - 3, w: 7, h: 6, vx: 115 * e.dir * (1 + round * 0.15), t: 0 });
      sfx.axe();
    }
  }

  function updateShots(dt) {
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      s.x += s.vx * dt;
      if (s.t !== undefined) s.t += dt;
      const gone = s.x < cam.x - 40 || s.x > cam.x + W + 40;
      if (gone || rectSolid(s.x, s.y, s.w, s.h)) {
        if (!gone) burst(s.x + s.w / 2, s.y, 5, s.kind === 'laser' ? ['#ff8080', '#ffffff'] : ['#c8c8d8'], { max: 60, life: 0.3 });
        shots.splice(i, 1);
        continue;
      }
      if (state === 'play' && p.inv <= 0 && overlap(p, s)) { shots.splice(i, 1); die(); return; }
    }
  }

  function updatePickups() {
    for (let i = pickups.length - 1; i >= 0; i--) {
      const k = pickups[i];
      if (!overlap(p, k)) continue;
      pickups.splice(i, 1);
      if (k.kind === 'dyn') { p.dyn = Math.min(MAX_DYN, p.dyn + 3); sfx.pickup(); popups.push({ x: k.x + 4, y: k.y - 4, text: '+3 DYNAMIT', t: 0 }); }
      else { sfx.gem(); addScore(250, k.x + 4, k.y - 4); if (!laserUsed) laserReady = true; }
    }
    if (chick && !chick.saved && overlap(p, chick)) {
      chick.saved = true;
      Sound.setJet(0);
      sfx.clear();
      burst(chick.x + 5, chick.y, 20, ['#ff6080', '#ffffff', '#ffd050'], { max: 80, up: 60, g: 80, life: 1.2 });
      lastTimeBonus = Math.max(0, Math.floor(parTime() - lvlT)) * TIME_PTS;
      tally = { energy: Math.floor(p.energy), fuel: Math.floor(p.fuel), energyShown: Math.floor(p.energy), fuelShown: Math.floor(p.fuel), dyn: p.dyn, time: lvlT, par: parTime(), tb: lastTimeBonus, tbShown: lastTimeBonus, t: 0, phase: 0 };
      setState('clear');
    }
  }

  function updateParticles(dt) {
    if (beam && (beam.t += dt) > 0.35) beam = null;
    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      q.t += dt;
      if (q.t >= q.life) { particles.splice(i, 1); continue; }
      q.vy += q.g * dt;
      q.x += q.vx * dt; q.y += q.vy * dt;
    }
    for (let i = popups.length - 1; i >= 0; i--) { popups[i].t += dt; popups[i].y -= dt * 20; if (popups[i].t > 1.1) popups.splice(i, 1); }
    // Glut über der Lava
    for (const [tx, ty] of lavaTiles) {
      if (Math.random() > 0.01 || tileAt(tx, ty - 1) !== '.') continue;
      if (tx * TS < cam.x - TS || tx * TS > cam.x + W) continue;
      particles.push({ x: tx * TS + rnd(2, 14), y: ty * TS, vx: rnd(-5, 5), vy: rnd(-30, -12), life: rnd(0.6, 1.2), t: 0,
        col: Math.random() < 0.5 ? '#ffd050' : '#ff9020', g: 0, size: 1 });
    }
    if (shake > 0) shake = Math.max(0, shake - dt);
    if (flash > 0) flash = Math.max(0, flash - dt);
  }

  function updateCamera(dt) {
    const target = p.x + p.w / 2 - W * 0.4;
    if (target > cam.x) cam.x += (target - cam.x) * Math.min(1, dt * 6);
    cam.x = clamp(cam.x, 0, lvlW * TS - W);
  }

  // ---------- Eigene Level: Prüfung (gleiche Regeln wie der Server in api/app.py) ----------
  const ED_TILES = '.#XDLPC+*bswATR';
  const ENEMY_CH = 'bswATR', ITEM_CH = '+*';
  const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const MIN_W = 30, MAX_W = 160, ED_MIN_W = 40;
  const API = '/api/levels';

  function findCode(s) {
    const m = /(?:^|[^A-Z0-9])([2-9A-HJKMNP-Z]{6})(?![A-Z0-9])/.exec(String(s).toUpperCase());
    return m ? m[1] : null;
  }

  function shapeError(rows) {
    if (!Array.isArray(rows) || rows.length !== ROWS) return 'UNGÜLTIGES LEVEL';
    const w = typeof rows[0] === 'string' ? rows[0].length : 0;
    if (!(w >= MIN_W && w <= MAX_W)) return 'UNGÜLTIGE LÄNGE';
    for (const r of rows) {
      if (typeof r !== 'string' || r.length !== w) return 'UNGÜLTIGES LEVEL';
      for (const ch of r) if (!ED_TILES.includes(ch)) return 'UNGÜLTIGES ZEICHEN';
    }
    return null;
  }

  function checkRows(rows) {
    const bad = shapeError(rows);
    if (bad) return bad;
    const w = rows[0].length;
    let P = null, C = null, enemies = 0, items = 0;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch === 'P') { if (P) return 'NUR EIN START ERLAUBT'; P = [x, y]; }
      else if (ch === 'C') { if (C) return 'NUR EIN KÜKEN ERLAUBT'; C = [x, y]; }
      else if (ENEMY_CH.includes(ch)) enemies++;
      else if (ITEM_CH.includes(ch)) items++;
    }
    if (!P) return 'START (TUX) FEHLT';
    if (!C) return 'KÜKEN FEHLT';
    if (enemies > 60) return 'HÖCHSTENS 60 MONSTER';
    if (items > 40) return 'HÖCHSTENS 40 GEGENSTÄNDE';
    const open = (x, y) => x >= 0 && x < w && y >= 0 && y < ROWS && rows[y][x] !== '#' && rows[y][x] !== 'L';
    if (!open(P[0], P[1] - 1)) return 'ÜBER DEM START FEHLT PLATZ';
    // Breitensuche: Tux belegt 1x2 Kacheln, sprengbare Wände gelten als offen
    const seen = new Uint8Array(w * ROWS), q = [P[0], P[1]];
    seen[P[1] * w + P[0]] = 1;
    for (let i = 0; i < q.length; i += 2) {
      const x = q[i], y = q[i + 1];
      if (x === C[0] && (y === C[1] || y - 1 === C[1])) return null;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!open(nx, ny) || !open(nx, ny - 1) || seen[ny * w + nx]) continue;
        seen[ny * w + nx] = 1;
        q.push(nx, ny);
      }
    }
    return 'KÜKEN IST NICHT ERREICHBAR';
  }

  // ---------- Zufallsgenerator ----------
  const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

  // Gang von links nach rechts: pro Spalte ein offener Bereich lo..hi (Gang, Schacht oder Höhle)
  function genCave(w) {
    const g = Array.from({ length: ROWS }, () => Array(w).fill('#'));
    const info = [];
    const carve = (x, a, b, kind) => { for (let r = a; r <= b; r++) g[r][x] = '.'; info[x] = { lo: a, hi: b, kind }; };
    let hi = ri(9, 13), lo = hi - ri(2, 4), c = 1;
    const end = w - 1;
    while (c < end) {
      const left = end - c, r = Math.random();
      if (r < 0.14 && left > 14 && c > 8) {
        const dir = lo <= 4 ? 1 : hi >= 11 ? -1 : Math.random() < 0.5 ? -1 : 1;
        const nhi = clamp(hi + ri(4, 8) * dir, 3, 14), nlo = Math.max(1, nhi - ri(2, 4));
        const a = Math.min(lo, nlo), b = Math.max(hi, nhi), sw = ri(2, 4);
        for (let i = 0; i < sw && c < end; i++, c++) carve(c, a, b, 's');
        lo = nlo; hi = nhi;
      } else if (r < 0.26 && left > 10 && c > 6) {
        const rw = ri(5, 9), top = Math.max(1, lo - ri(2, 5));
        for (let i = 0; i < rw && c < end; i++, c++) carve(c, top, hi, 'r');
      } else {
        const len = ri(3, 8);
        for (let i = 0; i < len && c < end; i++, c++) {
          // immer nur eine Grenze verschieben, damit sich Nachbarspalten um mindestens 2 Felder überlappen
          if (c > 4 && left - i > 6) {
            const m = ri(0, 5);
            if (m === 1 && lo > 1 && hi - lo < 5) lo--;
            else if (m === 2 && hi - lo > 1) lo++;
            else if (m === 3 && hi < 14 && hi - lo < 5) hi++;
            else if (m === 4 && hi - lo > 1) hi--;
          }
          carve(c, lo, hi, 'c');
          if (Math.random() < 0.15 && lo > 1 && c > 3) g[lo - 1][c] = '.'; // unebene Decke
        }
      }
    }
    return { g, info };
  }

  function genObstacles(g, info, w) {
    const used = new Uint8Array(w);
    const ok = (x) => x > 8 && x < w - 7 && !used[x - 1] && !used[x] && !used[x + 1];
    const order = () => {
      const a = [];
      for (let x = 9; x < w - 7; x++) a.push(x);
      for (let i = a.length - 1; i > 0; i--) { const j = ri(0, i); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    };
    const height = (x) => info[x].hi - info[x].lo + 1;
    const flat = (x, n) => { for (let i = 1; i < n; i++) if (!info[x - i] || info[x - i].hi !== info[x].hi) return false; return true; };
    const place = (x, row, ch) => { if (g[row][x] !== '.') return false; g[row][x] = ch; used[x] = 1; return true; };
    let blasts = 0, floorFoes = 0;

    // Sprengbare Wände und Türen, je 2 Spalten breit
    let walls = Math.max(1, Math.round(w / 30)) + Math.round(w / 50), doors = Math.round(w / 50);
    for (const x of order()) {
      if (walls <= 0) break;
      if (!ok(x) || !ok(x + 1) || info[x].kind !== 'c' || info[x + 1].kind !== 'c') continue;
      const t = doors > 0 && Math.random() < 0.4 ? 'D' : 'X';
      if (t === 'D') doors--;
      for (const xx of [x, x + 1]) { for (let r = 0; r < ROWS; r++) if (g[r][xx] === '.') g[r][xx] = t; used[xx] = 1; }
      walls--; blasts++;
    }
    // Lava am Boden oder an der Decke, nur wo darüber/darunter genug Platz bleibt
    let lava = Math.round(w / 22);
    for (const x of order()) {
      if (lava <= 0) break;
      if (!ok(x) || info[x].kind === 's' || height(x) < 4) continue;
      const ceil = Math.random() < 0.3, len = ri(1, 3);
      for (let xx = x; xx < x + len && xx < w - 7; xx++) {
        if (used[xx] || used[xx + 1] || info[xx].kind === 's' || height(xx) < 4) break;
        const row = ceil ? info[xx].lo : info[xx].hi;
        if (g[row][xx] === '.') g[row][xx] = 'L';
        used[xx] = 1;
      }
      lava--;
    }
    // Gegner
    let bats = Math.round(w / 25), spiders = Math.round(w / 35), bugs = Math.round(w / 30);
    let turrets = Math.round(w / 40), trolls = Math.round(w / 55);
    for (const x of order()) {
      if (!ok(x)) continue;
      const I = info[x], h = height(x);
      if (spiders > 0 && h >= 5 && I.kind !== 's') { if (place(x, I.lo, 's')) spiders--; }
      else if (bats > 0 && h >= 4) { if (place(x, I.lo + 1, 'b')) bats--; }
      else if (turrets > 0 && I.kind === 'c' && flat(x, 6)) { if (place(x, I.hi, 'T')) { turrets--; blasts++; } }
      else if (trolls > 0 && flat(x, 4)) { if (place(x, I.hi, 'A')) { trolls--; floorFoes++; } }
      else if (bugs > 0 && flat(x, 4)) { if (place(x, I.hi, 'w')) { bugs--; floorFoes++; } }
    }
    // Genug Dynamit für alle Hindernisse, gleichmäßig verteilt
    const need = blasts + Math.ceil(floorFoes / 2) + 2;
    const packs = Math.max(1, Math.ceil((need - START_DYN) / 3) + 1);
    for (let i = 0; i < packs; i++) {
      const target = Math.round((w * (i + 1)) / (packs + 1));
      for (let d = 0; d < 24; d++) {
        const x = target + (d % 2 ? -1 : 1) * Math.ceil(d / 2);
        if (x > 4 && x < w - 4 && !used[x] && info[x] && place(x, info[x].hi, '+')) break;
      }
    }
    // Edelsteine in Nischen der Decke
    let gems = Math.round(w / 30);
    for (const x of order()) {
      if (gems <= 0) break;
      const lo = info[x].lo;
      if (!used[x] && lo > 1 && g[lo - 1][x] === '.') { g[lo - 1][x] = '*'; gems--; }
    }
  }

  function genLevel(w, full) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const { g, info } = genCave(w);
      g[info[2].hi][2] = 'P';
      g[info[w - 3].hi][w - 3] = 'C';
      if (full) genObstacles(g, info, w);
      if (!checkRows(g.map((r) => r.join('')))) return g;
    }
    // Notlösung: gerader Gang
    const g = Array.from({ length: ROWS }, (_, r) => Array(w).fill(r >= 10 && r <= 13 ? '.' : '#'));
    for (let r = 10; r <= 13; r++) { g[r][0] = '#'; g[r][w - 1] = '#'; }
    g[13][2] = 'P'; g[13][w - 3] = 'C';
    return g;
  }

  // ---------- Level-Editor ----------
  const VIEW_X = 32, VIEW_W = W - VIEW_X;
  const TOOLS = [
    ['#', 'ERDE'], ['.', 'GRABEN'], ['X', 'RISSIGE WAND'], ['D', 'TÜR'], ['L', 'LAVA'], ['P', 'START (TUX)'],
    ['C', 'KÜKEN (ZIEL)'], ['+', 'DYNAMIT'], ['*', 'EDELSTEIN'], ['b', 'FLEDERMAUS'], ['s', 'SPINNE'], ['w', 'KÄFER'],
    ['A', 'AXT-TROLL'], ['T', 'LASER NACH LINKS'], ['R', 'LASER NACH RECHTS'],
  ];
  const TOOL_RECT = (i) => ({ x: (i % 2) * 16, y: HUD + 2 + Math.floor(i / 2) * 17, w: 16, h: 16 });
  const ED_R = {
    minus: { x: 1, y: 174, w: 14, h: 12, label: '-' }, plus: { x: 17, y: 174, w: 14, h: 12, label: '+' },
    left: { x: 1, y: 194, w: 14, h: 14, label: '<' }, right: { x: 17, y: 194, w: 14, h: 14, label: '>' },
  };
  const ED_BUTTONS = (() => {
    const list = [];
    let x = 2;
    for (const [id, label] of [['menu', 'MENÜ'], ['rand', 'ZUFALL'], ['empty', 'ZUFALL LEER'], ['undo', 'RÜCKGÄNGIG'], ['test', 'TESTEN'], ['share', 'TEILEN']]) {
      const w = textWidth(label) + 8;
      list.push({ id, label, x, y: 1, w, h: 12 });
      x += w + 3;
    }
    return list;
  })();
  const ed = { rows: null, w: 100, cam: 0, tool: '#', undo: [], verified: '', msg: '', msgT: 0, stroke: null, lastCell: '', changed: false, share: null };
  const inRect = (m, r) => m.x >= r.x && m.x < r.x + r.w && m.y >= r.y && m.y < r.y + r.h;
  const rowsToStrings = (g) => g.map((r) => r.join(''));

  // Symbole für Werkzeugleiste und Editoransicht
  function tileIcon(t) {
    const sg = grid, sw = lvlW;
    grid = Array.from({ length: ROWS }, (_, r) => Array(3).fill(t === '#' && r < 8 ? '.' : t));
    lvlW = 3;
    const c = canvas(TS, TS), g = c.getContext('2d'), img = g.createImageData(TS, TS);
    for (let ly = 0; ly < TS; ly++) for (let lx = 0; lx < TS; lx++) {
      const col = tilePixel(t, 1, 8, lx, ly);
      if (!col) continue;
      const o = (ly * TS + lx) * 4;
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    grid = sg; lvlW = sw;
    return c;
  }
  const PICK = sprite(['..hhhhhh....', '.hh..ww.hh..', 'h....ww...h.', '.....ww.....', '.....ww.....', '.....ww.....',
    '.....ww.....', '.....ww.....', '.....ww.....', '.....ww.....'], { h: '#c8c8d8', w: '#a06a30' });
  const ICONS = { P: SPR.stand[0], C: SPR.chick, '+': SPR.dynPack, '*': SPR.gem[0], b: SPR.bat[0], s: SPR.spider,
    w: SPR.bug[0][0], A: SPR.troll[0], T: SPR.turret[0][0], R: SPR.turret[1][0] };
  const PAL_ICONS = {
    '#': tileIcon('#'), X: tileIcon('X'), D: tileIcon('D'), P: SPR.life,
    '.': (() => { const c = canvas(TS, TS), g = c.getContext('2d'); g.drawImage(bgTile, 0, 0, TS, TS, 0, 0, TS, TS); g.drawImage(PICK, 2, 3); return c; })(),
  };
  function drawIcon(ch, x, y, world) {
    if (ch === 'L') { ctx.drawImage(lavaFrames[0][Math.floor(time * 8) % 8], x, y); return; }
    const s = (!world && PAL_ICONS[ch]) || ICONS[ch] || PAL_ICONS[ch];
    if (!s) return;
    const dx = x + Math.floor((TS - s.width) / 2);
    const dy = world && 'PwATR'.includes(ch) ? y + TS - s.height : y + Math.floor((TS - s.height) / 2);
    ctx.drawImage(s, dx, dy);
  }

  function edSave() { store.set('tuxo-editor', JSON.stringify(rowsToStrings(ed.rows))); }
  function edLoadSaved() {
    try {
      const r = JSON.parse(store.get('tuxo-editor') || 'null');
      if (r && !shapeError(r)) return r;
    } catch (e) { /* kaputter Entwurf: ignorieren */ }
    return null;
  }
  function edBind() {
    ed.w = ed.rows[0].length;
    grid = ed.rows; lvlW = ed.w;
    levelCv = canvas(lvlW * TS, ROWS * TS);
    levelCtx = levelCv.getContext('2d');
    renderTiles(0, 0, lvlW - 1, ROWS - 1);
    ed.cam = clamp(ed.cam, 0, Math.max(0, lvlW * TS - VIEW_W));
  }
  function enterEditor() {
    if (!ed.rows) {
      const saved = edLoadSaved();
      ed.rows = saved ? saved.map((r) => r.split('')) : genLevel(100, false);
    }
    Sound.setJet(0);
    edBind();
    setState('editor');
  }
  function openInEditor(rows, code) {
    if (!ed.rows) { const s = edLoadSaved(); if (s) ed.rows = s.map((r) => r.split('')); }
    if (ed.rows) edPush();
    ed.rows = rows.map((r) => r.split(''));
    ed.cam = 0; ed.verified = '';
    enterEditor();
    edSave();
    edMsg('LEVEL ' + code + ' GELADEN' + (ed.undo.length ? ' - RÜCKGÄNGIG HOLT DEINEN ENTWURF' : ''));
  }
  function edMsg(s) { ed.msg = s; ed.msgT = 3.5; }
  function edPush() { ed.undo.push(rowsToStrings(ed.rows)); if (ed.undo.length > 50) ed.undo.shift(); }
  function edUndo() {
    const u = ed.undo.pop();
    if (!u) { edMsg('NICHTS ZUM RÜCKGÄNGIG MACHEN'); return; }
    ed.rows = u.map((r) => r.split(''));
    edBind(); edSave();
  }
  function edSet(tx, ty, ch) {
    if (tx < 0 || tx >= ed.w || ty < 0 || ty >= ROWS || ed.rows[ty][tx] === ch) return false;
    // Start und Küken gibt es nur einmal: altes entfernen
    if (ch === 'P' || ch === 'C') for (const r of ed.rows) { const i = r.indexOf(ch); if (i >= 0) r[i] = '.'; }
    const redraw = SOLID[ed.rows[ty][tx]] || SOLID[ch];
    ed.rows[ty][tx] = ch;
    if (redraw) renderTiles(tx - 1, ty - 1, tx + 1, ty + 1);
    return true;
  }
  function edResize(d) {
    const nw = clamp(ed.w + d, ED_MIN_W, MAX_W);
    if (nw === ed.w) { edMsg(d > 0 ? 'HÖCHSTENS ' + MAX_W + ' SPALTEN' : 'MINDESTENS ' + ED_MIN_W + ' SPALTEN'); return; }
    edPush();
    ed.rows = ed.rows.map((r) => (nw > r.length ? r.concat(Array(nw - r.length).fill('#')) : r.slice(0, nw)));
    edBind(); edSave();
  }
  function edAction(id) {
    const strings = rowsToStrings(ed.rows);
    if (id === 'menu') setState('title');
    else if (id === 'rand' || id === 'empty') {
      edPush();
      ed.rows = genLevel(ed.w, id === 'rand');
      ed.cam = 0;
      edBind(); edSave();
      edMsg(id === 'rand' ? 'ZUFALLSLEVEL ERZEUGT' : 'ZUFALLSGANG OHNE HINDERNISSE ERZEUGT');
    } else if (id === 'undo') edUndo();
    else if (id === 'test') { const err = checkRows(strings); if (err) edMsg(err); else startCustom(strings, '', true); }
    else if (id === 'share') {
      const err = checkRows(strings);
      if (err) edMsg(err);
      else if (ed.verified !== strings.join('\n')) edMsg('ERST TESTEN UND BIS ZUM KÜKEN SPIELEN!');
      else shareLevel(strings);
    }
  }

  function updateEditor(dt) {
    if (ed.msgT > 0) ed.msgT -= dt;
    let dir = (K.right() ? 1 : 0) - (K.left() ? 1 : 0);
    if (mouse.down && mouse.button === 0) { if (inRect(mouse, ED_R.left)) dir = -1; if (inRect(mouse, ED_R.right)) dir = 1; }
    ed.cam += dir * 320 * dt;
    if (mouse.wheel) { ed.cam += mouse.wheel * 0.5; mouse.wheel = 0; }
    ed.cam = clamp(ed.cam, 0, Math.max(0, ed.w * TS - VIEW_W));
    if (consume('Undo')) edUndo();
    if (consume('Escape')) { setState('title'); return; }
    if (click) {
      const b = ED_BUTTONS.find((r) => inRect(mouse, r));
      if (b) { edAction(b.id); return; }
      TOOLS.forEach(([ch], i) => { if (inRect(mouse, TOOL_RECT(i))) ed.tool = ch; });
      if (inRect(mouse, ED_R.minus)) edResize(-10);
      if (inRect(mouse, ED_R.plus)) edResize(10);
    }
    // Malen: linke Taste mit Werkzeug, rechte Taste gräbt; ein Pinselstrich = ein Rückgängig-Schritt
    const inView = mouse.x >= VIEW_X && mouse.x < W && mouse.y >= HUD && mouse.y < H;
    if (inView && (click || rclick)) { ed.stroke = rowsToStrings(ed.rows); ed.lastCell = ''; ed.changed = false; }
    if (!mouse.down || !ed.stroke) {
      if (ed.stroke && ed.changed) { ed.undo.push(ed.stroke); if (ed.undo.length > 50) ed.undo.shift(); edSave(); }
      ed.stroke = null;
      return;
    }
    if (!inView) return;
    const tx = Math.floor((mouse.x - VIEW_X + ed.cam) / TS), ty = Math.floor((mouse.y - HUD) / TS);
    const cell = tx + ',' + ty;
    if (cell === ed.lastCell) return;
    ed.lastCell = cell;
    const ch = mouse.button === 2 ? '.' : ed.tool;
    if (ICONS[ch] && !(click || rclick)) return; // Figuren und Gegenstände nur per Klick, nicht durch Ziehen
    if (edSet(tx, ty, ch)) ed.changed = true;
  }

  function rectLine(x, y, w, h, col) {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
  }
  function drawButton(b) {
    const hov = inRect(mouse, b);
    ctx.fillStyle = hov ? '#4a3a6a' : '#241a36';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    rectLine(b.x, b.y, b.w, b.h, hov ? '#f0c040' : '#6a5a8a');
    drawText(b.label, b.x + b.w / 2, b.y + Math.floor((b.h - 5) / 2), '#ffffff', 1, 'center', null);
  }
  function rowButtons(labels, y) {
    const ws = labels.map((l) => textWidth(l) + 16);
    let x = Math.round(W / 2 - (ws.reduce((a, b) => a + b, 0) + (labels.length - 1) * 8) / 2);
    return labels.map((label, i) => { const b = { label, x, y, w: ws[i], h: 14 }; x += ws[i] + 8; return b; });
  }
  function panel(y, h) {
    ctx.fillStyle = 'rgba(10,6,20,0.94)'; ctx.fillRect(40, y, W - 80, h);
    ctx.fillStyle = '#f0c040'; ctx.fillRect(40, y, W - 80, 1); ctx.fillRect(40, y + h - 1, W - 80, 1);
  }

  function drawEditor() {
    ctx.fillStyle = '#0c0814'; ctx.fillRect(0, 0, W, H);
    const cx = Math.round(ed.cam);
    ctx.save();
    ctx.beginPath(); ctx.rect(VIEW_X, HUD, VIEW_W, H - HUD); ctx.clip();
    const off = -Math.round(cx * 0.5) % 64;
    for (let x = VIEW_X + off - 64; x < W; x += 64) for (let y = 0; y < ROWS * TS; y += 64) ctx.drawImage(bgTile, x, HUD + y);
    ctx.translate(VIEW_X - cx, HUD);
    ctx.drawImage(levelCv, cx, 0, VIEW_W, ROWS * TS, cx, 0, VIEW_W, ROWS * TS);
    const lf = Math.floor(time * 8) % 8, tx0 = Math.floor(cx / TS), tx1 = Math.min(ed.w - 1, tx0 + 29);
    for (let ty = 0; ty < ROWS; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const ch = ed.rows[ty][tx];
      if (ch === 'L') ctx.drawImage(lavaFrames[ty % 2][lf], tx * TS, ty * TS);
      else if (ICONS[ch]) drawIcon(ch, tx * TS, ty * TS, true);
    }
    if (mouse.x >= VIEW_X && mouse.x < W && mouse.y >= HUD && mouse.y < H) {
      const tx = Math.floor((mouse.x - VIEW_X + cx) / TS), ty = Math.floor((mouse.y - HUD) / TS);
      if (ed.tool !== '.') { ctx.globalAlpha = 0.5; drawIcon(ed.tool, tx * TS, ty * TS, !SOLID[ed.tool]); ctx.globalAlpha = 1; }
      rectLine(tx * TS, ty * TS, TS, TS, '#f0c040');
    }
    ctx.restore();

    // Werkzeugleiste links
    ctx.fillStyle = '#0c0814'; ctx.fillRect(0, HUD, VIEW_X, H - HUD);
    ctx.fillStyle = '#4a3a6a'; ctx.fillRect(VIEW_X - 1, HUD, 1, H - HUD);
    TOOLS.forEach(([ch], i) => {
      const r = TOOL_RECT(i);
      ctx.fillStyle = '#1c1428'; ctx.fillRect(r.x, r.y, r.w, r.h);
      drawIcon(ch, r.x, r.y, false);
      if (ch === ed.tool) rectLine(r.x, r.y, r.w, r.h, '#f0c040');
      else if (inRect(mouse, r)) rectLine(r.x, r.y, r.w, r.h, '#8878a8');
    });
    drawText('LÄNGE', 16, 158, '#9a8ac0', 1, 'center', null);
    drawText(String(ed.w), 16, 166, '#ffffff', 1, 'center', null);
    Object.values(ED_R).forEach(drawButton);
    const tw = 30, th = Math.max(3, Math.round((tw * VIEW_W) / (ed.w * TS)));
    const tp = Math.round((tw - th) * (ed.cam / Math.max(1, ed.w * TS - VIEW_W)));
    ctx.fillStyle = '#2a2040'; ctx.fillRect(1, 214, tw, 4);
    ctx.fillStyle = '#f0c040'; ctx.fillRect(1 + tp, 214, th, 4);
    ['RECHTS-', 'KLICK =', 'GRABEN'].forEach((l, i) => drawText(l, 16, 232 + i * 8, '#665588', 1, 'center', null));

    // Leiste oben
    ctx.fillStyle = '#0c0814'; ctx.fillRect(0, 0, W, HUD);
    ctx.fillStyle = '#4a3a6a'; ctx.fillRect(0, HUD - 1, W, 1);
    ED_BUTTONS.forEach(drawButton);
    let status, col = '#9a8ac0';
    if (ed.msgT > 0) { status = ed.msg; col = '#ffe060'; }
    else {
      const hov = TOOLS.findIndex((t, i) => inRect(mouse, TOOL_RECT(i)));
      status = TOOLS[hov >= 0 ? hov : TOOLS.findIndex((t) => t[0] === ed.tool)][1];
    }
    drawText(status, W - 4, 5, col, 1, 'right', null);
  }

  // ---------- Teilen und Laden ----------
  let codeBuf = '', codeErr = '', busyText = '';
  const errText = (e) => (e instanceof TypeError || (e && e.name === 'AbortError') ? 'KEINE VERBINDUNG ZUM SERVER' : String((e && e.message) || e).toUpperCase());
  async function request(url, opts = {}) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 10000);
    try {
      const r = await fetch(url, { ...opts, signal: ctl.signal });
      let j = {};
      try { j = await r.json(); } catch (e) { /* kein JSON */ }
      if (!r.ok) throw new Error(j.error || 'SERVERFEHLER (' + r.status + ')');
      return j;
    } finally { clearTimeout(t); }
  }
  const api = (path, opts) => request(API + path, opts);
  function shareLevel(rows) {
    busyText = 'SPEICHERE LEVEL ...';
    setState('busy');
    api('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }) })
      .then((j) => {
        if (!findCode(j.code || '')) throw new Error('SERVERFEHLER');
        ed.share = { code: j.code, link: location.origin + '/#' + j.code, copied: false };
        setState('share');
      })
      .catch((e) => { setState('editor'); edMsg(errText(e)); });
  }
  function loadByCode(code) {
    busyText = 'LADE LEVEL ' + code + ' ...';
    setState('busy');
    api('/' + code)
      .then((j) => {
        const err = checkRows(j.rows);
        if (err) throw new Error('LEVEL DEFEKT: ' + err);
        startCustom(j.rows, code, false);
      })
      .catch((e) => { codeBuf = code; codeErr = errText(e); setState('codeinput'); });
  }
  function startCustom(rows, code, testing) {
    mode = testing ? 'test' : 'custom';
    curRows = rows; curCode = code;
    score = 0; lives = 3; round = 0; levelIdx = 0; nextLife = 20000;
    const segments = [];
    for (let x = 0; x < rows[0].length; x += 16) segments.push(rows.map((r) => r.slice(x, x + 16)));
    loadLevelData({ name: testing ? 'TESTLAUF' : 'LEVEL ' + code, hints: {}, segments });
    setState('intro');
    sfx.start();
  }

  function openCodeInput() {
    codeErr = ''; typed.length = 0;
    if (isTouch) {
      const s = window.prompt('Level-Code oder Link eingeben:');
      if (s === null) { setState('title'); return; }
      const c = findCode(s);
      if (c) { loadByCode(c); return; }
      codeBuf = ''; codeErr = 'KEIN GÜLTIGER CODE';
    } else codeBuf = '';
    setState('codeinput');
  }
  const codeButtons = () => rowButtons(['LADEN', 'ABBRECHEN'], 168);
  function updateCodeInput() {
    for (const k of typed) {
      if (k === 'Backspace') codeBuf = codeBuf.slice(0, -1);
      else { const c = k.toUpperCase(); if (CODE_ALPHABET.includes(c) && codeBuf.length < 6) { codeBuf += c; codeErr = ''; } }
    }
    typed.length = 0;
    const bs = codeButtons();
    if (consume('Escape') || (click && inRect(mouse, bs[1]))) { setState('title'); return; }
    if (consume('Enter') || (click && inRect(mouse, bs[0]))) {
      if (codeBuf.length === 6) loadByCode(codeBuf);
      else if (isTouch) openCodeInput();
      else codeErr = 'DER CODE HAT 6 ZEICHEN';
    }
  }
  function drawCodeInput() {
    drawTitle(); dim(0.8);
    panel(70, 124);
    drawText('LEVEL-CODE EINGEBEN', W / 2, 82, '#ffd050', 2, 'center');
    for (let i = 0; i < 6; i++) {
      const x = Math.round(W / 2 - 66 + i * 22), y = 104;
      ctx.fillStyle = '#1c1428'; ctx.fillRect(x, y, 18, 24);
      ctx.fillStyle = i === codeBuf.length && (time * 3 | 0) % 2 ? '#ffe060' : '#6a5a8a'; ctx.fillRect(x, y + 23, 18, 1);
      if (codeBuf[i]) drawText(codeBuf[i], x + 9, y + 5, '#ffffff', 3, 'center');
    }
    if (codeErr) drawText(codeErr, W / 2, 140, '#ff6050', 1, 'center');
    else drawText(isTouch ? 'TIPPE AUF LADEN' : 'TIPPEN ODER CODE/LINK EINFÜGEN (STRG+V)', W / 2, 140, '#8878a8', 1, 'center');
    codeButtons().forEach(drawButton);
  }

  const shareButtons = () => rowButtons(['LINK KOPIEREN', 'FERTIG'], 176);
  function updateShare() {
    const bs = shareButtons();
    if (click && inRect(mouse, bs[0])) {
      const s = ed.share;
      if (navigator.clipboard) navigator.clipboard.writeText(s.link).then(() => { s.copied = true; }, () => { s.copied = 'fail'; });
      else s.copied = 'fail';
    }
    if (consume('Enter', 'Escape') || (click && inRect(mouse, bs[1]))) setState('editor');
  }
  function drawShare() {
    drawEditor(); dim(0.75);
    panel(50, 172);
    const s = ed.share;
    drawText('DEIN LEVEL-CODE', W / 2, 62, '#ffd050', 2, 'center');
    drawText(s.code, W / 2, 84, '#ffffff', 6, 'center');
    drawText(s.link.replace(/^https?:\/\//, ''), W / 2, 126, '#c8c0e0', 1, 'center');
    const msg = s.copied === true ? 'LINK KOPIERT!' : s.copied === 'fail' ? 'KOPIEREN NICHT MÖGLICH - BITTE ABSCHREIBEN' : 'MIT CODE ODER LINK KÖNNEN ANDERE DEIN LEVEL SPIELEN';
    drawText(msg, W / 2, 146, s.copied === 'fail' ? '#ff6050' : s.copied ? '#50d050' : '#8878a8', 1, 'center');
    shareButtons().forEach(drawButton);
    drawText('WER DEN CODE KENNT, KANN DAS LEVEL SPIELEN.', W / 2, 204, '#665588', 1, 'center', null);
  }

  const doneButtons = () => rowButtons(['NOCHMAL', 'IM EDITOR ÖFFNEN', 'MENÜ'], 166);
  function updateCustomDone() {
    const bs = doneButtons();
    if (consume('Space') || (click && inRect(mouse, bs[0]))) startCustom(curRows, curCode, false);
    else if (click && inRect(mouse, bs[1])) openInEditor(curRows, curCode);
    else if (consume('Enter', 'Escape') || (click && inRect(mouse, bs[2]))) setState('title');
  }
  function drawBusy() {
    ctx.fillStyle = '#0c0814'; ctx.fillRect(0, 0, W, H);
    drawText(busyText, W / 2, 130, '#ffffff', 2, 'center');
  }

  // ---------- Bestenliste (global, über die Level-API) ----------
  const SCORES_API = '/api/scores';
  const NAME_MAX = 10, NAME_CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ0123456789.-!'; // wie NAME_RE in api/app.py
  const ROW_COLS = ['#ff4040', '#ff9020', '#ffe040', '#a0ff40', '#40ff90', '#40e0ff', '#4090ff', '#a070ff', '#ff60e0', '#ffffff'];
  const board = { status: 'idle', list: [], err: '', mine: -1, attract: false, fromGame: false };
  let nm = { s: '', i: 0, err: '' };
  const pad6 = (n) => String(n).padStart(6, '0');
  // Spielrunde vom Server: ohne sie nimmt die API keinen Eintrag an (prüft Alter und Punkte gegen die Level)
  let run = { token: null, practice: true };
  function startRun() {
    const r = run = { token: null, practice: false };
    request('/api/runs', { method: 'POST' }).then((j) => { r.token = j.run || null; }).catch(() => {});
  }
  function fetchScores() {
    board.status = 'loading';
    request(SCORES_API)
      .then((j) => { board.list = Array.isArray(j.scores) ? j.scores.slice(0, 10) : []; board.status = 'ok'; })
      .catch((e) => { board.status = 'error'; board.err = errText(e); });
  }
  const qualifies = (pts) => pts > 0 && (board.list.length < 10 || pts > board.list[board.list.length - 1].score);
  function showScores(attract, fresh) {
    board.attract = attract; board.fromGame = !attract && !fresh; board.mine = -1;
    if (fresh) fetchScores();
    setState('scores');
  }
  function updateScores() {
    if ((stateT > 1 && (consume('Enter', 'Space', 'Escape') || click)) || stateT > (board.attract ? 10 : 30)) setState('title');
  }

  // Namenseingabe wie am Automaten: hoch/runter wählt das Zeichen, links/rechts die Stelle; Tippen geht auch
  const nameButtons = () => rowButtons(['EINTRAGEN', 'ÜBERSPRINGEN'], 196);
  function enterName() {
    const s = (store.get('tuxo-name') || '').toUpperCase().split('').filter((c) => NAME_CHARS.includes(c)).join('').slice(0, NAME_MAX);
    nm = { s, i: Math.min(s.length, NAME_MAX - 1), err: '' };
    typed.length = 0;
    setState('nameentry');
    sfx.life();
  }
  function setNameChar(c) { const a = nm.s.split(''); a[nm.i] = c; nm.s = a.join(''); nm.err = ''; }
  function updateNameEntry() {
    for (const k of typed) {
      if (k === 'Backspace') {
        if (nm.i > 0) { nm.s = nm.s.slice(0, nm.i - 1) + nm.s.slice(nm.i); nm.i--; }
        continue;
      }
      const c = k.toUpperCase();
      if (NAME_CHARS.includes(c) && (nm.i < nm.s.length || nm.s.length < NAME_MAX)) { setNameChar(c); nm.i = Math.min(nm.i + 1, NAME_MAX - 1); }
    }
    typed.length = 0;
    const cycle = (d) => setNameChar(NAME_CHARS[(NAME_CHARS.indexOf(nm.s[nm.i] || ' ') + d + NAME_CHARS.length) % NAME_CHARS.length]);
    if (consume('ArrowUp')) cycle(1);
    if (consume('ArrowDown')) cycle(-1);
    if (consume('ArrowLeft')) nm.i = Math.max(0, nm.i - 1);
    if (consume('ArrowRight')) nm.i = Math.min(nm.s.length, nm.i + 1, NAME_MAX - 1);
    const bs = nameButtons();
    if (consume('Escape') || (click && inRect(mouse, bs[1]))) { showScores(false, false); return; }
    if (consume('Enter') || (isTouch && consume('Space')) || (click && inRect(mouse, bs[0]))) submitName();
    consume('Space'); // auf der Tastatur ist die Leertaste ein Zeichen (kommt über typed)
  }
  function submitName() {
    const name = nm.s.split(' ').filter(Boolean).join(' ');
    if (!name) { nm.err = 'BITTE GIB EINEN NAMEN EIN'; return; }
    store.set('tuxo-name', name);
    if (isCheater(name)) { startWitch(name); return; }
    postScore(name, score);
  }
  function postScore(name, pts) {
    busyText = 'TRAGE DICH EIN ...';
    setState('busy');
    request(SCORES_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, score: pts, levels: levelIdx, run: run.token }) })
      .then((j) => {
        board.list = Array.isArray(j.scores) ? j.scores : []; board.status = 'ok';
        board.attract = false; board.fromGame = true; board.mine = j.rank ? j.rank - 1 : -1;
        setState('scores');
        sfx.clear();
      })
      .catch((e) => { nm.err = errText(e); setState('nameentry'); });
  }
  function drawNameEntry() {
    drawBackdrop();
    ctx.fillStyle = 'rgba(6,3,12,0.6)'; ctx.fillRect(0, 0, W, H);
    panel(36, 190);
    drawText('NEUER EINTRAG IN DER BESTENLISTE!', W / 2, 48, '#ffd050', 2, 'center');
    drawText('PUNKTE ' + pad6(score), W / 2, 70, '#ffffff', 2, 'center');
    drawText('DEIN NAME:', W / 2, 94, '#9a8ac0', 1, 'center');
    for (let i = 0; i < NAME_MAX; i++) {
      const x = Math.round(W / 2 - 110 + i * 22), y = 106, cur = i === nm.i;
      ctx.fillStyle = cur ? '#2c2040' : '#1c1428'; ctx.fillRect(x, y, 18, 24);
      ctx.fillStyle = cur && (time * 3 | 0) % 2 ? '#ffe060' : '#6a5a8a'; ctx.fillRect(x, y + 23, 18, 1);
      if (nm.s[i] && nm.s[i] !== ' ') drawText(nm.s[i], x + 9, y + 5, cur ? '#ffe060' : '#ffffff', 3, 'center');
    }
    drawText(isTouch ? 'HOCH/RUNTER: ZEICHEN   LINKS/RECHTS: STELLE   BOOM: FERTIG'
      : 'NAMEN TIPPEN ODER PFEILTASTEN   ENTER: FERTIG', W / 2, 146, '#8878a8', 1, 'center');
    if (nm.err) drawText(nm.err, W / 2, 164, '#ff6050', 1, 'center');
    else drawText('DER NAME IST FÜR ALLE SPIELER SICHTBAR', W / 2, 164, '#665588', 1, 'center');
    nameButtons().forEach(drawButton);
  }
  function drawScores() {
    drawBackdrop();
    ctx.fillStyle = 'rgba(6,3,12,0.55)'; ctx.fillRect(0, 0, W, H);
    logo(W / 2, 12, 5, 'BESTENLISTE');
    drawText('PLATZ', 128, 50, '#9a8ac0', 1, 'right', null);
    drawText('NAME', 142, 50, '#9a8ac0', 1, 'left', null);
    drawText('PUNKTE', 352, 50, '#9a8ac0', 1, 'right', null);
    if (board.status === 'loading' && !board.list.length) drawText('LADE ...', W / 2, 120, '#c8c0e0', 2, 'center');
    else if (board.status === 'error') {
      drawText('BESTENLISTE NICHT ERREICHBAR', W / 2, 110, '#ff6050', 2, 'center');
      drawText(board.err, W / 2, 130, '#c8c0e0', 1, 'center');
    } else {
      for (let i = 0; i < 10; i++) {
        const e = board.list[i], y = 62 + i * 15, mine = i === board.mine;
        const col = mine && (time * 6 | 0) % 2 ? '#ffffff' : ROW_COLS[i];
        ctx.globalAlpha = e ? 1 : 0.3;
        drawText((i + 1) + '.', 128, y, col, 2, 'right');
        drawText(e ? e.name : '----------', 142, y, col, 2);
        drawText(pad6(e ? e.score : 0), 352, y, col, 2, 'right');
        ctx.globalAlpha = 1;
        if (mine) { drawText('>', 104 - (time * 4 | 0) % 2 * 2, y, '#ffffff', 2, 'right'); drawText('<', 362 + (time * 4 | 0) % 2 * 2, y, '#ffffff', 2); }
      }
    }
    if (board.fromGame && board.mine < 0) drawText('DEINE PUNKTE ' + pad6(score), W / 2, 220, '#f0c040', 1, 'center');
    if ((time * 2 | 0) % 2) drawText(isTouch ? 'TIPPEN ZUM WEITERMACHEN' : 'ENTER ODER LEERTASTE', W / 2, 240, '#c8c0e0', 1, 'center');
  }

  // ---------- Schnitzel-Modus (Easter Egg) ----------
  // IDDQDIDKFA im Titelmenü schaltet um; gilt für diesen Browser (localStorage)
  const CHEAT = 'IDDQDIDKFA';
  const SCH_COLS = ['#ff6080', '#ffd050', '#60d0ff', '#80ff80', '#ffffff', '#ff9020', '#c080ff'];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const easeOutBack = (x) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);
  // Bild nur für die Animation; geladen wird es, sobald jemand den Code zu tippen beginnt
  let schImg = null;
  function loadSchImg() { if (!schImg && typeof Image === 'function') schImg = Object.assign(new Image(), { src: 'schnitzel.png' }); }
  let cheatBuf = '', schnitzel = false, schFx = null;
  function setSkin(on) {
    schnitzel = on;
    Object.assign(SPR, on ? SKINS.schnitzel : SKINS.tux);
  }
  function cheatKey(ch) {
    if (schFx) return;
    cheatBuf = (cheatBuf + ch).slice(-CHEAT.length);
    for (let k = 3; k <= cheatBuf.length; k++) if (CHEAT.startsWith(cheatBuf.slice(-k))) loadSchImg();
    if (cheatBuf !== CHEAT) return;
    loadSchImg();
    cheatBuf = '';
    setSkin(!schnitzel);
    store.set('tuxo-schnitzel', schnitzel ? '1' : '0');
    schFx = { on: schnitzel, t: 0, sparks: [], rockets: [], next: 0.25, fanfare: false };
    if (schnitzel) Sound.tone(200, 1.1, { to: 900, type: 'triangle', vol: 0.12 });
    else Sound.melody([784, 659, 523, 392, 262], 0.1, { vol: 0.18, type: 'triangle' });
  }
  function updateSchnitzelFx(dt) {
    const f = schFx, dur = f.on ? 6 : 3;
    f.t += dt;
    if (f.on) {
      if (f.t >= f.next && f.t < dur - 1.2) {
        f.next = f.t + rnd(0.15, 0.4);
        f.rockets.push({ x: rnd(40, W - 40), y: H + 4, vy: rnd(-230, -170), fuse: rnd(0.6, 1.0), col: pick(SCH_COLS) });
        Sound.tone(rnd(500, 700), 0.35, { to: rnd(1400, 1800), type: 'triangle', vol: 0.04 });
      }
      if (!f.fanfare && f.t > 1.3) { f.fanfare = true; Sound.melody([523, 659, 784, 1047, 0, 784, 1047, 1319], 0.09, { vol: 0.18 }); }
    }
    for (let i = f.rockets.length - 1; i >= 0; i--) {
      const r = f.rockets[i];
      r.y += r.vy * dt; r.vy += 90 * dt; r.fuse -= dt;
      f.sparks.push({ x: r.x + rnd(-1, 1), y: r.y + 2, vx: rnd(-8, 8), vy: rnd(10, 30), t: 0, life: 0.3, col: '#ffd890' });
      if (r.fuse > 0) continue;
      f.rockets.splice(i, 1);
      const c2 = pick(SCH_COLS);
      for (let k = 0; k < 36; k++) {
        const a = (k / 36) * Math.PI * 2 + rnd(-0.1, 0.1), s = rnd(50, 110);
        f.sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: rnd(0.8, 1.4), col: k % 3 ? r.col : c2 });
      }
      Sound.noise(0.5, { vol: 0.3, freq: 2600, to: 150 });
    }
    for (let i = f.sparks.length - 1; i >= 0; i--) {
      const q = f.sparks[i];
      q.t += dt;
      if (q.t >= q.life) { f.sparks.splice(i, 1); continue; }
      q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 70 * dt; q.vx *= 0.985;
    }
    const skip = f.t > 1.5 && (consume('Enter', 'Space', 'Escape') || click);
    if (f.t > dur || skip) { schFx = null; for (const k in hit) hit[k] = false; }
  }
  function drawSchnitzelFx() {
    const f = schFx, t = f.t;
    const fade = clamp(Math.min(t * 3, ((f.on ? 6 : 3) - t) * 2), 0, 1);
    ctx.fillStyle = `rgba(6,3,12,${0.88 * fade})`; ctx.fillRect(0, 0, W, H);
    for (const q of f.sparks) {
      ctx.globalAlpha = 1 - q.t / q.life;
      ctx.fillStyle = q.col; ctx.fillRect(Math.round(q.x), Math.round(q.y), 2, 2);
    }
    ctx.globalAlpha = 1;
    if (schImg && schImg.complete && schImg.naturalWidth) {
      let x, y, k, a, alpha;
      if (f.on) {
        // rotierend von unten links herein, dann leichtes Wackeln
        const u = Math.min(1, t / 1.2), e = easeOutBack(u);
        x = -90 + (W / 2 + 90) * e; y = H + 90 - (H + 90 - 104) * e;
        k = 0.15 + 0.85 * e; a = (1 - u) * Math.PI * 5 + (u >= 1 ? Math.sin((t - 1.2) * 3) * 0.12 : 0);
        alpha = fade;
      } else {
        // dreht sich nach oben rechts davon
        const u = Math.min(1, t / 1.4), e = u * u;
        x = W / 2 + e * 300; y = 104 - e * 200; k = 1 - u * 0.8; a = e * Math.PI * 6; alpha = 1 - u;
      }
      const S = 150 * k;
      ctx.save();
      ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = true;
      ctx.translate(x, y); ctx.rotate(a);
      ctx.drawImage(schImg, -S / 2, -S / 2, S, S);
      ctx.restore();
    }
    const tt = f.on ? t - 1.3 : t - 0.2;
    if (tt <= 0) return;
    const pop = tt < 0.35 ? easeOutBack(tt / 0.35) : 1;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(W / 2, 196); ctx.scale(pop, pop);
    drawText(f.on ? 'SCHNITZEL-MODUS AKTIVIERT!' : 'SCHNITZEL-MODUS DEAKTIVIERT', 0, -7,
      f.on && (time * 8 | 0) % 2 ? '#ffe060' : '#ff9020', 3, 'center');
    ctx.restore();
    ctx.globalAlpha = fade;
    if (tt > 0.5) drawText(f.on ? 'AB JETZT SPIELST DU ALS SCHNITZEL' : 'TUX IST ZURÜCK', W / 2, 222, '#c8c0e0', 1, 'center');
    ctx.globalAlpha = 1;
  }

  // ---------- Die Hexe (Easter Egg) ----------
  // Bekannte Cheater der Bestenliste: Eine Hexe halbiert die Punkte, bevor sie eingetragen werden.
  // Der Name muss eines der Wörter enthalten; ACTIONSCHNITZEL passt nicht in 10 Zeichen, daher reicht der Anfang.
  // Verglichen wird in einer vereinfachten Form, damit T1MO, T.I.M.O, TIIMO, K1M 88 oder SCHN1TZ3L nicht durchrutschen.
  const CHEATERS = ['KIM88', 'SAMUEL', 'TIMO', 'ACTIONSCH', 'SCHNITZEL'];
  const LEET = { 0: 'O', 1: 'I', L: 'I', 2: 'Z', 3: 'E', 4: 'A', 5: 'S', 6: 'G', 7: 'T', 8: 'B', 9: 'G', 'Ä': 'A', 'Ö': 'O', 'Ü': 'U' };
  const simplify = (s) => s.toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, '').replace(/./g, (c) => LEET[c] || c);
  const CHEATER_RES = CHEATERS.map((c) => new RegExp(simplify(c).split('').map((ch) => ch + '+').join(''))); // TIIMO, KIM888
  const isCheater = (name) => { const n = simplify(name); return CHEATER_RES.some((re) => re.test(n)); };
  const WITCH_SAY = 'NA WENN WIR DA MAL NICHT EINEN UNSERER CHEATER ZURÜCK IM SPIEL HABEN. DANN WOLLEN WIR MAL!';
  const WITCH_UPSI = 'UPSI.. DAS REICHT WOHL NICHT MEHR FÜR EINEN EINTRAG IN DIE LISTE';
  const WITCH_PAL = { k: '#1a1024', y: '#f0c040', h: '#d85a20', g: '#7ac04a', G: '#4e8c30', w: '#ffffff', r: '#a01828',
    P: '#3a1450', p: '#6a2a8a', b: '#7a4a20', s: '#e0b050' };
  const WITCH_TOP = [
    '.............kk.........',
    '............kkk.........',
    '...........kkkk.........',
    '..........kkkkk.........',
    '.........kkkkkk.........',
    '........kkkkkkkk........',
    '........kkkkkkkk........',
    '.......kyyyyyyyyk.......',
    '....kkkkkkkkkkkkkkkk....',
    '.....hhgggggggggghh.....',
    '.....hhggwkggwkgggh.....',
    '....hhhgggggggggGGGg....',
    '....hhggggggggggGGGGG...',
  ];
  const WITCH_MOUTH = [[ // zu
    '....hhgggggggggggg......',
    '....hhggrrrrrrgggh......',
    '.....hhgggggggggh.......',
  ], [ // offen (lacht)
    '....hhgggrrrrrgggg......',
    '....hhggrwkwkwrggh......',
    '.....hhggrrrrrgggh......',
  ]];
  const WITCH_BODY = [
    '......hh.ggGgg.hh.......',
    '.......hPPpppppPh.......',
    '.......PpppppppppP......',
    '......PpppppppppppP.....',
    '......PppyyyyyyyppP.....',
    '......PpppppppppppP.....',
    '.....PpppppppppppppP....',
    '.....PpppppppppppppP....',
    '....PppppppppppppppPP...',
    '....PppppppppppppppppP..',
    '...PPPPPPPPPPPPPPPPPPP..',
    '.......kkk.....kkk......',
    '......kkkk....kkkkk.....',
  ];
  const BROOM = [
    'sss.....................................',
    'ssssssbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'sss.....................................',
  ];
  const WITCH_SPR = WITCH_MOUTH.map((m) => outlined(sprite([...WITCH_TOP, ...m, ...WITCH_BODY], WITCH_PAL), '#c8a0ff'));
  const BROOM_SPR = sprite(BROOM, WITCH_PAL);
  const WS = 4; // die Hexe wird vierfach vergrößert gezeichnet
  const smooth = (u) => u * u * (3 - 2 * u);
  function wrapText(s, max) {
    const lines = [''];
    for (const w of s.split(' ')) {
      const l = lines[lines.length - 1];
      if (l && (l + ' ' + w).length > max) lines.push(w); else lines[lines.length - 1] = l ? l + ' ' + w : w;
    }
    return lines;
  }
  let witch = null;
  function startWitch(name) {
    const to = Math.floor(score / 2), talkEnd = 1.4 + WITCH_SAY.length / 30;
    // Nach dem Spruch wartet die Hexe bei `hold` auf Taste oder Klick, damit man in Ruhe lesen kann
    const hold = talkEnd + 1.0, wave = hold + 0.2, scoreAt = wave + 1.4, countStart = scoreAt + 0.7, countEnd = countStart + 2.5;
    const ok = qualifies(to);
    witch = { name, from: score, to, ok, t: 0, go: false, sparks: [], hihi: [], talkEnd, hold, wave, scoreAt, countStart, countEnd,
      end: ok ? countEnd + 1.8 : countEnd + 0.4 + WITCH_UPSI.length / 30 };
    setState('witch');
  }
  function cackle(f, delay = 0) {
    for (let i = 0; i < 7; i++) Sound.tone(1150 - i * 60, 0.07, { to: 820 - i * 60, type: 'square', vol: 0.07, delay: delay + i * 0.1 });
    f.hihi.push({ t: -delay });
  }
  // Lage der Hexe, ihres Arms und der Zauberstabspitze (Bildschirmkoordinaten)
  function witchPose(f) {
    const t = f.t, u = Math.min(1, t / 1.2);
    const x = Math.round(-110 + 126 * (1 - Math.pow(1 - u, 3))), y = Math.round(84 + Math.sin(time * 2.2) * 4);
    const waving = t > f.wave && t < f.scoreAt + 0.3;
    const arm = waving ? -0.55 + Math.sin((t - f.wave) * 14) * 0.4 : t > f.countEnd && !f.ok ? 0.5 : 0.25;
    const wand = arm - (waving ? 0.25 : 0.7);
    const sx = 17, sy = 19, hx = sx + Math.cos(arm) * 6, hy = sy + Math.sin(arm) * 6;
    return { x, y, arm, wand, sx, sy, hx, hy, tip: [x + (hx + Math.cos(wand) * 8) * WS, y + (hy + Math.sin(wand) * 8) * WS] };
  }
  function updateWitch(dt) {
    const f = witch, was = f.t;
    // Eingaben zählen nur beim Warten nach dem Spruch und ganz am Ende, sonst werden sie verschluckt
    let press = click;
    for (const k in hit) { if (hit[k]) press = true; hit[k] = false; }
    if (!f.go && f.t >= f.hold && press) { f.go = true; press = false; }
    f.t = f.go ? f.t + dt : Math.min(f.hold, f.t + dt);
    const at = (x) => was < x && f.t >= x;
    if (at(1.4)) cackle(f);
    if (at(f.talkEnd)) cackle(f, 0.1);
    if (at(f.wave)) { Sound.tone(300, 1.4, { to: 1800, type: 'triangle', vol: 0.1 }); Sound.melody([1568, 1319, 1568, 1760, 2093], 0.12, { type: 'triangle', vol: 0.06 }); }
    if (at(f.scoreAt)) {
      Sound.noise(0.5, { vol: 0.3, freq: 5000, to: 400, type: 'highpass' });
      for (let k = 0; k < 40; k++) {
        const a = (k / 40) * Math.PI * 2, s = rnd(40, 120);
        f.sparks.push({ x: W / 2, y: 150, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: rnd(0.6, 1.1), col: pick(SCH_COLS) });
      }
    }
    if (f.t > f.countStart && f.t < f.countEnd && (time * 30 | 0) % 2) sfx.tally();
    if (at(f.countEnd)) {
      if (f.ok) cackle(f, 0.2);
      else { Sound.melody([392, 330, 262, 196], 0.18, { type: 'triangle', vol: 0.2 }); cackle(f, 0.9); }
    }
    // Funken vom Zauberstab zur Mitte
    const pose = witchPose(f);
    if (f.t > f.wave && f.t < f.countEnd) for (let k = 0; k < 2; k++) {
      const [tx, ty] = pose.tip, tgt = f.t < f.scoreAt;
      const vx = tgt ? (W / 2 - tx) * rnd(0.9, 1.4) : rnd(-30, 30), vy = tgt ? (150 - ty) * rnd(0.9, 1.4) : rnd(-30, 30);
      f.sparks.push({ x: tx, y: ty, vx, vy, t: 0, life: tgt ? 0.7 : 0.4, col: pick(['#ffe060', '#ffffff', '#c080ff', '#80e0ff']) });
    }
    for (let i = f.sparks.length - 1; i >= 0; i--) {
      const q = f.sparks[i];
      if ((q.t += dt) >= q.life) { f.sparks.splice(i, 1); continue; }
      q.x += q.vx * dt; q.y += q.vy * dt;
    }
    for (const h of f.hihi) h.t += dt;
    f.hihi = f.hihi.filter((h) => h.t < 1.6);
    // Am Ende: Eintrag oder (zu wenig Punkte) mit Taste/Klick zurück ins Menü
    if (f.t < f.end) return;
    if (f.ok) { witch = null; postScore(f.name, f.to); }
    else if (press) { witch = null; setState('title'); }
  }
  function bubble(text, x, y, mx, my, shown) {
    const lines = wrapText(text, 30), w = 30 * 8 + 16, h = lines.length * 14 + 12;
    ctx.fillStyle = '#1a1024';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = '#fff8e8';
    ctx.fillRect(x, y, w, h);
    // Spitze zum Mund der Hexe
    ctx.beginPath(); ctx.moveTo(x + 14, y + h - 1); ctx.lineTo(mx, my); ctx.lineTo(x + 40, y + h - 1); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#1a1024'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 14, y + h); ctx.lineTo(mx, my); ctx.lineTo(x + 40, y + h); ctx.stroke();
    let left = shown;
    lines.forEach((l, i) => {
      if (left > 0) drawText(l.slice(0, left), x + 8, y + 8 + i * 14, '#1a1024', 2, 'left', null);
      left -= l.length + 1;
    });
  }
  function drawWitch() {
    const f = witch, t = f.t;
    drawBackdrop();
    ctx.fillStyle = 'rgba(6,3,12,0.7)'; ctx.fillRect(0, 0, W, H);
    const P = witchPose(f), talking = (t > 1.4 && t < f.talkEnd + 1) || (t > f.countEnd && t < f.countEnd + 2.5);
    const px = (x, y, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(P.x + x * WS), Math.round(P.y + y * WS), WS, WS); };
    // Besen, Hexe, Arm mit Zauberstab
    ctx.drawImage(BROOM_SPR, P.x - 8 * WS, P.y + 26 * WS, BROOM_SPR.width * WS, BROOM_SPR.height * WS);
    ctx.drawImage(WITCH_SPR[talking && (time * 10 | 0) % 2 ? 1 : 0], P.x, P.y, WITCH_SPR[0].width * WS, WITCH_SPR[0].height * WS);
    for (let i = 0; i <= 6; i++) px(Math.round(P.sx + Math.cos(P.arm) * i), Math.round(P.sy + Math.sin(P.arm) * i), '#6a2a8a');
    for (let i = 1; i <= 8; i++) px(Math.round(P.hx + Math.cos(P.wand) * i), Math.round(P.hy + Math.sin(P.wand) * i), '#3a2410');
    px(Math.round(P.hx), Math.round(P.hy), '#7ac04a');
    const [tx, ty] = P.tip, star = (time * 12 | 0) % 2 ? '#ffffff' : '#ffe060';
    ctx.fillStyle = star;
    ctx.fillRect(tx - 1, ty - 4, 3, 9); ctx.fillRect(tx - 4, ty - 1, 9, 3);
    for (const q of f.sparks) {
      ctx.globalAlpha = 1 - q.t / q.life;
      ctx.fillStyle = q.col; ctx.fillRect(Math.round(q.x), Math.round(q.y), 2, 2);
    }
    ctx.globalAlpha = 1;
    for (const h of f.hihi) if (h.t > 0) {
      ctx.globalAlpha = clamp(1.6 - h.t, 0, 1);
      drawText('HIHIHI!', P.x + 60 + h.t * 20, P.y - 4 - h.t * 24, '#a0ff60', 2, 'center');
      ctx.globalAlpha = 1;
    }
    // Sprechblase: erst der Spruch, nach dem Zählen bei zu wenig Punkten das Upsi
    const mx = P.x + 18 * WS, my = P.y + 14 * WS;
    if (t > 1.4 && t < f.wave) bubble(WITCH_SAY, 150, 28, mx, my, Math.floor((t - 1.4) * 30));
    if (!f.ok && t > f.countEnd + 0.4) bubble(WITCH_UPSI, 150, 28, mx, my, Math.floor((t - f.countEnd - 0.4) * 30));
    // Punkte in der Mitte, zählen rückwärts bis zur Hälfte
    if (t > f.scoreAt) {
      const u = clamp((t - f.countStart) / (f.countEnd - f.countStart), 0, 1);
      const shown = u >= 1 ? f.to : Math.round(f.from - (f.from - f.to) * smooth(u));
      const pop = Math.min(1, (t - f.scoreAt) / 0.3);
      ctx.globalAlpha = pop;
      drawText('PUNKTE', W / 2, 128, '#9a8ac0', 1, 'center');
      drawText(String(shown), W / 2, 140, u >= 1 ? (f.ok ? '#50d050' : '#ff5050') : '#ffffff', 5, 'center');
      ctx.globalAlpha = 1;
    }
    if (!f.go && t >= f.hold && (time * 2 | 0) % 2) drawText('TASTE ODER KLICK: WEITER', W / 2, 246, '#c8c0e0', 1, 'center');
    if (t >= f.end && !f.ok && (time * 2 | 0) % 2) drawText('TASTE ODER KLICK: ZURÜCK ZUM MENÜ', W / 2, 246, '#c8c0e0', 1, 'center');
  }

  // ---------- Titelmenü und Pause ----------
  const MENU = ['SPIELEN', 'LEVEL-EDITOR', 'LEVEL-CODE EINGEBEN', 'BESTENLISTE'];
  let menuSel = 0;
  const menuRects = () => MENU.map((l, i) => { const w = textWidth(l, 2) + 20; return { x: Math.round(W / 2 - w / 2), y: 124 + i * 17, w, h: 16 }; });
  function updateTitle(dt) {
    if (schFx) { updateSchnitzelFx(dt); return; }
    if (inputSeen) { inputSeen = false; stateT = 0; }
    if (stateT > 25) { showScores(true, true); return; } // wie am Automaten: im Leerlauf die Bestenliste zeigen
    if (consume('ArrowUp', 'KeyW')) menuSel = (menuSel + MENU.length - 1) % MENU.length;
    if (consume('ArrowDown', 'KeyS')) menuSel = (menuSel + 1) % MENU.length;
    const rs = menuRects();
    if (mouse.moved) { rs.forEach((r, i) => { if (inRect(mouse, r)) menuSel = i; }); mouse.moved = false; }
    if (click && inRect(mouse, SHAME_BTN)) { openShame(); return; }
    let go = consume('Enter', 'Space');
    if (click) { const i = rs.findIndex((r) => inRect(mouse, r)); if (i >= 0) { menuSel = i; go = true; } }
    if (!go) return;
    if (menuSel === 0) startGame();
    else if (menuSel === 1) enterEditor();
    else if (menuSel === 2) openCodeInput();
    else showScores(false, true);
  }

  // ---------- Hall of Shame (Easter Egg) ----------
  // Klein oben rechts im Titel. Die Fotos liegen als <img> (#shame) über dem Canvas, damit sie scharf bleiben;
  // das Canvas zeichnet Rahmen und Namen. Geladen wird erst beim ersten Öffnen.
  const SHAME_BTN = { x: W - 61, y: 2, w: 59, h: 11 };
  const SHAME = [['KIM88', 'shame-kim88.jpg'], ['ACTIONSCHNITZEL', 'shame-actionschnitzel.jpg']];
  const SHAME_S = 190, SHAME_GAP = 20, SHAME_Y = 44;
  const shameRect = (i) => ({ x: W / 2 - SHAME_S - SHAME_GAP / 2 + i * (SHAME_S + SHAME_GAP), y: SHAME_Y, w: SHAME_S, h: SHAME_S });
  const shameEl = document.getElementById('shame');
  function openShame() {
    if (shameEl) shameEl.querySelectorAll('img').forEach((img, i) => {
      const r = shameRect(i), pct = (v, of) => (v / of) * 100 + '%';
      Object.assign(img.style, { left: pct(r.x, W), top: pct(r.y, H), width: pct(r.w, W), height: pct(r.h, H) });
      if (!img.getAttribute('src')) img.src = SHAME[i][1];
    });
    Sound.melody([392, 370, 349, 330], 0.3, { type: 'triangle', vol: 0.2 }); // „wah wah wah wahhh“
    setState('shame');
  }
  function updateShame() {
    let any = false;
    for (const k in hit) { if (hit[k]) any = true; hit[k] = false; }
    if (stateT > 0.5 && (any || click)) setState('title');
  }
  function drawShame() {
    drawBackdrop();
    ctx.fillStyle = 'rgba(6,3,12,0.6)'; ctx.fillRect(0, 0, W, H);
    logo(W / 2, 8, 5, 'HALL OF SHAME');
    SHAME.forEach(([name], i) => {
      const r = shameRect(i);
      ctx.fillStyle = '#f0c040'; ctx.fillRect(r.x - 3, r.y - 3, r.w + 6, r.h + 6);
      ctx.fillStyle = '#1a1024'; ctx.fillRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
      drawText('LADE ...', r.x + r.w / 2, r.y + r.h / 2 - 3, '#665588', 1, 'center'); // verdeckt, sobald das Foto da ist
      drawText(name, r.x + r.w / 2, r.y + r.h + 6, '#ff5050', 2, 'center');
    });
    if ((time * 2 | 0) % 2) drawText('TASTE ODER KLICK: ZURÜCK', W / 2, 260, '#c8c0e0', 1, 'center');
  }
  // ---------- C64-Android und Arkanoid (Easter Egg) ----------
  // Selten ersetzt beim Levelstart ein C64-Android einen Käfer oder Troll (loadLevelData). Zwei Sprengungen
  // besiegen ihn, übrig bleibt ein C64 (relic). Ein Klick darauf startet eine Runde Arkanoid; das Spiel steht so lange.
  const C64_PAL = { m: '#c8c0a8', M: '#8a8270', s: '#352879', c: '#a0a0ff', k: '#14141e', b: '#a89878', B: '#6a5a40',
    d: '#3a3028', r: '#d83020', o: '#f09020', y: '#f0e040', g: '#40b040', l: '#6a6a7a' };
  const C64_TOP = [
    '..mmmmmmmmmmmm..',
    '..mssssssssssm..',
    '..msccssssccsm..',
    '..mssssssssssm..',
    '..mssccccccssm..',
    '..mmmmmmmmmmmm..',
    '.....MMMMMM.....',
    '.bbbbbbbbbbbbbb.',
    'lbdbdbdbdbdbdbbl',
    'lbbdbdbdbdbdbdbl',
    'lbbbbbbbbbroygbl',
    '.BBBBBBBBBBBBBB.',
  ];
  const C64_LEGS = [
    ['...ll......ll...', '...ll......ll...', '..kkk......kkk..'],
    ['....ll....ll....', '...ll......ll...', '..kkk.....kkk...'],
  ];
  // [unverletzt, wütend (roter Bildschirm)] × [Schritt 1, Schritt 2]
  const C64_SPR = [C64_PAL, { ...C64_PAL, s: '#883932', c: '#ffe040' }].map((pal) =>
    C64_LEGS.map((legs) => outlined(sprite([...C64_TOP, ...legs], pal), '#20202c')));
  const RELIC_SPR = outlined(sprite([
    '...bbbbbbbbbbb..',
    '..bdbdbdbdbdbbb.',
    '.bbdbdbdbdbdbbb.',
    '.bbbbbbbbbroygb.',
    '.BBBBBBBBBBBBBB.',
  ], C64_PAL), '#20202c');

  // Arkanoid im C64-Bildschirm: Rahmen hellblau, Bild dunkelblau wie beim Original
  const AK = { x: 104, y: 36, w: 272, h: 196, bd: 8 };
  const AF = { x: AK.x + AK.bd, y: AK.y + AK.bd + 12, w: AK.w - 2 * AK.bd, h: AK.h - 2 * AK.bd - 12 }; // Spielfeld
  const AK_COLS = ['#b86962', '#bfce72', '#94e089', '#67b6bd'];
  const AK_BOOT = [[0, '    **** COMMODORE 64 BASIC V2 ****'], [0, ' 64K RAM SYSTEM  38911 BASIC BYTES FREE'], [0, ''],
    [0, 'READY.'], [0.4, 'LOAD"ARKANOID",8,1', 1], [1.4, ''], [1.4, 'SEARCHING FOR ARKANOID'], [1.8, 'LOADING'],
    [2.4, 'READY.'], [2.6, 'RUN', 1]];
  const AK_BOOT_T = 3.0, AK_END_T = 1.6;
  function relicClicked() {
    if (!relic || !click) return false;
    const wx = mouse.x + cam.x, wy = mouse.y - HUD;
    return wx >= relic.x - 6 && wx < relic.x + relic.w + 6 && wy >= relic.y - 14 && wy < relic.y + relic.h + 4;
  }
  function openArk() {
    relic = null; // nur eine Runde pro C64
    Sound.setJet(0);
    Sound.melody([523, 659, 784, 1047, 784, 1047, 1319], 0.06, { vol: 0.12 });
    const bricks = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++)
      bricks.push({ x: AF.x + 8 + c * 30, y: AF.y + 14 + r * 10, w: 28, h: 8, col: AK_COLS[r], alive: true });
    ark = { phase: 'boot', t: 0, bricks, balls: 2, px: AF.x + AF.w / 2 - 18, pw: 36, speed: 130, ball: null };
    newBall();
    setState('arkanoid');
  }
  function newBall() { ark.ball = { x: ark.px + ark.pw / 2 - 1.5, y: AF.y + AF.h - 14, vx: 0, vy: 0, stuck: 1.0 }; }
  function closeArk() { ark = null; setState('play'); }
  function updateArk(dt) {
    const a = ark;
    a.t += dt;
    if (a.phase === 'boot') {
      if (a.t > AK_BOOT_T || (a.t > 0.3 && consume('Space', 'Enter'))) { a.phase = 'play'; a.t = 0; }
      return;
    }
    if (a.phase !== 'play') { if (a.t > AK_END_T) closeArk(); return; }
    // Schläger
    const dir = (K.right() ? 1 : 0) - (K.left() ? 1 : 0);
    a.px = clamp(a.px + dir * 170 * dt, AF.x, AF.x + AF.w - a.pw);
    const py = AF.y + AF.h - 10, b = a.ball;
    if (b.stuck > 0) {
      b.x = a.px + a.pw / 2 - 1.5; b.y = py - 4;
      b.stuck -= dt;
      if (b.stuck <= 0 || consume('Space', 'ArrowUp')) { b.stuck = 0; b.vx = a.speed * 0.45; b.vy = -a.speed * 0.9; }
      return;
    }
    // Ball: getrennt nach Achsen bewegen, damit Abprallen an Steinen sauber bleibt
    const hitBrick = () => a.bricks.find((k) => k.alive && b.x < k.x + k.w && b.x + 3 > k.x && b.y < k.y + k.h && b.y + 3 > k.y);
    const smash = (k) => {
      k.alive = false;
      a.speed = Math.min(200, a.speed + 3);
      Sound.tone(880 + (k.y - AF.y) * 6, 0.06, { vol: 0.12 });
    };
    b.x += b.vx * dt;
    if (b.x < AF.x || b.x + 3 > AF.x + AF.w) { b.x = clamp(b.x, AF.x, AF.x + AF.w - 3); b.vx = -b.vx; Sound.tone(330, 0.04, { vol: 0.08 }); }
    let k = hitBrick();
    if (k) { smash(k); b.x -= b.vx * dt; b.vx = -b.vx; }
    b.y += b.vy * dt;
    if (b.y < AF.y) { b.y = AF.y; b.vy = -b.vy; Sound.tone(330, 0.04, { vol: 0.08 }); }
    k = hitBrick();
    if (k) { smash(k); b.y -= b.vy * dt; b.vy = -b.vy; }
    // Schläger: Auftreffpunkt bestimmt den Winkel (bis 60° zur Senkrechten)
    if (b.vy > 0 && b.y + 3 >= py && b.y + 3 <= py + 5 && b.x + 3 > a.px && b.x < a.px + a.pw) {
      const rel = clamp((b.x + 1.5 - (a.px + a.pw / 2)) / (a.pw / 2), -1, 1), ang = rel * 1.05;
      b.vx = a.speed * Math.sin(ang); b.vy = -a.speed * Math.cos(ang); b.y = py - 3;
      Sound.tone(440, 0.05, { vol: 0.12 });
    }
    // Geschwindigkeit nachführen (sie steigt mit jedem Stein)
    const v = Math.hypot(b.vx, b.vy);
    if (v > 0) { b.vx *= a.speed / v; b.vy *= a.speed / v; }
    if (!a.bricks.some((s) => s.alive)) {
      a.phase = 'won'; a.t = 0;
      Sound.melody([523, 659, 784, 1047, 0, 784, 1047], 0.09, { vol: 0.16 });
    } else if (b.y > AF.y + AF.h) {
      a.balls--;
      Sound.tone(600, 0.5, { to: 80, vol: 0.18 });
      if (a.balls <= 0) { a.phase = 'lost'; a.t = 0; } else newBall();
    }
  }
  function drawArk() {
    const a = ark;
    dim(0.55);
    ctx.fillStyle = '#6c5eb5'; ctx.fillRect(AK.x, AK.y, AK.w, AK.h);
    ctx.fillStyle = '#352879'; ctx.fillRect(AK.x + AK.bd, AK.y + AK.bd, AK.w - 2 * AK.bd, AK.h - 2 * AK.bd);
    const tx = AK.x + AK.bd + 4, ty = AK.y + AK.bd + 4;
    if (a.phase === 'boot') {
      let row = 0, last = null;
      for (const [at, text, typed] of AK_BOOT) {
        if (a.t < at) break;
        const s = typed ? text.slice(0, Math.floor((a.t - at) * 25)) : text;
        drawText(s, tx, ty + row * 8, '#a0a0ff', 1, 'left', null);
        last = [tx + textWidth(s) + 1, ty + row * 8];
        row++;
      }
      if (last && (time * 3 | 0) % 2) { ctx.fillStyle = '#a0a0ff'; ctx.fillRect(last[0], last[1] - 1, 4, 7); } // Cursor
      return;
    }
    drawText('ARKANOID', tx, ty, '#a0a0ff', 1, 'left', null);
    drawText('BÄLLE ' + Math.max(0, a.balls), AK.x + AK.w - AK.bd - 4, ty, '#a0a0ff', 1, 'right', null);
    for (const k of a.bricks) if (k.alive) {
      ctx.fillStyle = k.col; ctx.fillRect(k.x, k.y, k.w, k.h);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(k.x, k.y, k.w, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(k.x, k.y + k.h - 1, k.w, 1);
    }
    const py = AF.y + AF.h - 10;
    ctx.fillStyle = '#c8c0a8'; ctx.fillRect(Math.round(a.px), py, a.pw, 4);
    ctx.fillStyle = '#ff7070'; ctx.fillRect(Math.round(a.px), py, 3, 4); ctx.fillRect(Math.round(a.px) + a.pw - 3, py, 3, 4);
    if (a.phase === 'play') { ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(a.ball.x), Math.round(a.ball.y), 3, 3); }
    if (a.phase === 'play' && a.ball.stuck > 0) drawText('LINKS/RECHTS: SCHLÄGER', AK.x + AK.w / 2, AF.y + 90, '#a0a0ff', 1, 'center', null);
    if (a.phase === 'won') drawText('GESCHAFFT!', AK.x + AK.w / 2, AF.y + 80, '#94e089', 3, 'center');
    if (a.phase === 'lost') drawText('GAME OVER', AK.x + AK.w / 2, AF.y + 80, '#b86962', 3, 'center');
  }

  // NEU VERSUCHEN: kostet ein Leben, z. B. wenn Tux mit leerem Tank oder ohne Dynamit festsitzt
  const pauseButtons = () => rowButtons(['WEITER', 'NEU VERSUCHEN', mode === 'test' ? 'ZUM EDITOR' : 'AUFGEBEN'], 150);
  function updatePause() {
    const bs = pauseButtons();
    if (consume('KeyP', 'Escape', 'Enter') || (click && inRect(mouse, bs[0]))) paused = false;
    else if (consume('KeyR') || (click && inRect(mouse, bs[1]))) { paused = false; die('NEUER VERSUCH'); }
    else if (consume('KeyQ') || (click && inRect(mouse, bs[2]))) {
      paused = false;
      Sound.setJet(0);
      if (mode === 'test') enterEditor();
      else if (mode === 'campaign') finishGame();
      else setState('title');
    }
  }

  // ---------- Hauptschleife ----------
  let click = false, rclick = false;
  function update(dt) {
    time += dt;
    stateT += dt;
    click = mouse.clicked; rclick = mouse.rclicked;
    mouse.clicked = mouse.rclicked = false;
    if (state !== 'codeinput' && state !== 'nameentry') typed.length = 0;
    if (state !== 'editor') mouse.wheel = 0;
    if (state !== 'codeinput' && state !== 'nameentry' && consume('KeyM')) Sound.toggleMute();
    switch (state) {
      case 'title': updateTitle(dt); break;
      case 'editor': updateEditor(dt); break;
      case 'share': updateShare(); break;
      case 'codeinput': updateCodeInput(); break;
      case 'customdone': updateCustomDone(); break;
      case 'nameentry': updateNameEntry(); break;
      case 'witch': updateWitch(dt); break;
      case 'shame': updateShame(); break;
      case 'arkanoid': updateArk(dt); break; // das eigentliche Spiel steht still
      case 'scores': updateScores(); break;
      case 'busy': break;
      case 'intro':
        updateParticles(dt);
        if (stateT > 2.2 || (stateT > 0.5 && (consume('Enter', 'Space') || click))) { consume('Space'); setState('play'); }
        break;
      case 'play':
        if (paused) { updatePause(); return; }
        lvlT += dt;
        if (mode === 'test' && consume('Escape')) { enterEditor(); break; }
        if (consume('KeyP', 'Escape')) { paused = true; Sound.setJet(0); return; }
        if (relicClicked()) { openArk(); break; }
        updatePlayer(dt);
        if (state !== 'play') break;
        if (consume('ShiftLeft', 'ShiftRight')) fireLaser();
        updateDynamite(dt);
        updateCrumbles(dt);
        updateEnemies(dt);
        updateShots(dt);
        if (state !== 'play') break;
        updatePickups();
        updateParticles(dt);
        updateCamera(dt);
        break;
      case 'dying':
        lvlT += dt;
        updateDynamite(dt); updateCrumbles(dt); updateEnemies(dt); updateShots(dt); updateParticles(dt);
        if (stateT > 1.8) {
          if (mode !== 'test') lives--;
          if (lives < 0) { finishGame(); break; }
          shots = []; dyn = null;
          const keepDyn = Math.max(p.dyn, 3);
          p = Object.assign(newPlayer(respawn.x, respawn.y), { dyn: keepDyn, inv: 2 });
          // Gegner, die direkt am Rücksetzpunkt stehen würden, bleiben trotzdem aktiv – dafür kurze Unverwundbarkeit
          cam.x = clamp(Math.min(cam.x, p.x - 100), 0, lvlW * TS - W);
          consume('Space');
          setState('play');
        }
        break;
      case 'clear':
        updateParticles(dt);
        tally.t += dt;
        if (tally.phase === 0 && tally.t > 1.2) tally.phase = 1;
        if (tally.phase === 1) {
          // Energie und Tank je 5 Punkte pro Einheit (zusammen höchstens 1000 – wie die Grenze in api/app.py)
          const k = tally.energy > 0 ? 'energy' : 'fuel', n = Math.min(tally[k], 2);
          if (n > 0) { tally[k] -= n; addScore(n * 5); if ((time * 30 | 0) % 2) sfx.tally(); }
          else { tally.phase = 2; tally.t = 0; }
        } else if (tally.phase === 2 && tally.t > 0.3) {
          if (tally.dyn > 0) { tally.dyn--; addScore(50); sfx.tally(); tally.t = 0.05; }
          else { tally.phase = 3; tally.t = 0; }
        } else if (tally.phase === 3 && tally.t > 0.3) {
          const n = Math.min(tally.tb, 40);
          if (n > 0) { tally.tb -= n; addScore(n); if ((time * 30 | 0) % 2) sfx.tally(); }
          else { tally.phase = 4; tally.t = 0; }
        } else if (tally.phase === 4 && tally.t > 1.6) {
          if (mode === 'test') { ed.verified = curRows.join('\n'); enterEditor(); edMsg('GESCHAFFT! JETZT KANNST DU DAS LEVEL TEILEN'); break; }
          if (mode === 'custom') { setState('customdone'); break; }
          levelIdx++;
          if (levelIdx % LEVELS.length === 0) { round++; setState('victory'); sfx.life(); }
          else { loadLevel(levelIdx); setState('intro'); }
        }
        break;
      case 'victory':
        updateParticles(dt);
        if (Math.random() < 0.3) burst(rnd(60, W - 60), rnd(40, 140), 12, ['#ff6080', '#ffd050', '#60d0ff', '#80ff80', '#ffffff'], { max: 70, g: 60, life: 1.2 });
        if (stateT > 2 && (consume('Enter', 'Space') || click)) { loadLevel(levelIdx); setState('intro'); }
        if (stateT > 9) { loadLevel(levelIdx); setState('intro'); }
        break;
      case 'gameover':
        // weiter erst, wenn die Bestenliste geladen ist (oder der Abruf scheiterte)
        if (board.status !== 'loading' && ((stateT > 1.5 && (consume('Enter', 'Space') || click)) || stateT > 10)) afterGameOver();
        break;
    }
  }

  function finishGame() {
    Sound.setJet(0);
    sfx.over();
    if (mode === 'campaign' && score > hiscore) { hiscore = score; store.set('tuxo-hiscore', String(hiscore)); }
    if (mode === 'campaign') fetchScores();
    setState('gameover');
  }
  function afterGameOver() {
    if (mode !== 'campaign') setState('title');
    else if (board.status === 'ok' && qualifies(score) && !run.practice) enterName();
    else showScores(false);
  }

  // ---------- Zeichnen ----------
  function drawWorld() {
    const sx = shake > 0 ? Math.round(rnd(-2, 2) * shake * 6) : 0;
    const sy = shake > 0 ? Math.round(rnd(-2, 2) * shake * 6) : 0;
    const cx = Math.round(cam.x);
    // Rückwand mit Parallaxe
    const off = -Math.round(cx * 0.5) % 64;
    for (let x = off - 64; x < W + 64; x += 64) for (let y = 0; y < ROWS * TS; y += 64) ctx.drawImage(bgTile, x + sx, HUD + y + sy);

    ctx.save();
    ctx.beginPath(); ctx.rect(0, HUD, W, H - HUD); ctx.clip();
    ctx.translate(-cx + sx, HUD + sy);

    ctx.drawImage(levelCv, cx - 16, 0, W + 32, ROWS * TS, cx - 16, 0, W + 32, ROWS * TS);
    const lf = Math.floor(time * 8) % 8;
    for (const [tx, ty] of lavaTiles) {
      if (tx * TS < cx - TS || tx * TS > cx + W) continue;
      ctx.drawImage(lavaFrames[ty % 2][lf], tx * TS, ty * TS);
    }

    // Hinweise
    for (const h of hints) {
      if (Math.abs(p.x - h.x) > 150 || !h.text) continue;
      const lines = h.text.split('\n');
      const wmax = Math.max(...lines.map((l) => textWidth(l))) + 10;
      const bx = clamp(h.x - wmax / 2, cx + 4, cx + W - wmax - 4), by = h.y - 6 - lines.length * 4;
      ctx.fillStyle = 'rgba(10,6,16,0.82)'; ctx.fillRect(Math.round(bx), by, wmax, lines.length * 8 + 6);
      ctx.fillStyle = '#f0c040'; ctx.fillRect(Math.round(bx), by, wmax, 1); ctx.fillRect(Math.round(bx), by + lines.length * 8 + 5, wmax, 1);
      lines.forEach((l, i) => drawText(l, bx + wmax / 2, by + 4 + i * 8, '#ffffff', 1, 'center', null));
    }

    // Gegenstände
    for (const k of pickups) {
      const bob = Math.round(Math.sin(time * 4 + k.x) * 1.5);
      if (k.kind === 'dyn') ctx.drawImage(SPR.dynPack, k.x, k.y - 2 + bob);
      else ctx.drawImage(SPR.gem[(time * 4 | 0) % 2], k.x, k.y + bob);
    }

    // Küken
    if (chick) {
      const hop = chick.saved ? -Math.abs(Math.sin(time * 10)) * 6 : -Math.abs(Math.sin(time * 5)) * 2;
      ctx.drawImage(SPR.chick, chick.x, Math.round(chick.y + hop));
      if (!chick.saved && (time * 2 | 0) % 2) drawText('HILFE!', chick.x + 5, chick.y - 9, '#ffffff', 1, 'center');
      if (chick.saved) drawText('DANKE!', chick.x + 5, chick.y - 12, '#ffd050', 1, 'center');
    }

    // Gegner
    for (const e of enemies) {
      if (e.dead) continue;
      if (e.kind === 'bat') ctx.drawImage(SPR.bat[(time * 8 | 0) % 2], Math.round(e.x - 1), Math.round(e.y));
      else if (e.kind === 'spider') {
        ctx.fillStyle = '#b0b0c0'; ctx.fillRect(Math.round(e.x + 5), e.ay, 1, Math.round(e.y - e.ay) + 1);
        ctx.drawImage(SPR.spider, Math.round(e.x), Math.round(e.y));
      } else if (e.kind === 'bug') ctx.drawImage(SPR.bug[(e.t * 6 | 0) % 2][e.vx < 0 ? 0 : 1], Math.round(e.x), Math.round(e.y - 1));
      else if (e.kind === 'turret') {
        const blink = e.charge > 0 && (time * 20 | 0) % 2;
        ctx.drawImage(SPR.turret[e.dir < 0 ? 0 : 1][blink ? 1 : 0], Math.round(e.x - 1), e.y);
      } else if (e.kind === 'troll') {
        const s = SPR.troll[e.dir < 0 ? 0 : 1];
        ctx.drawImage(s, Math.round(e.x - 1), e.y + (e.charge > 0 ? -1 : 0));
      } else if (e.kind === 'c64') {
        if (e.hurt > 0 && (time * 20 | 0) % 2) continue; // blinkt nach dem ersten Treffer
        ctx.drawImage(C64_SPR[e.hp > 1 ? 0 : 1][(e.t * 5 | 0) % 2], Math.round(e.x - 1), Math.round(e.y));
      }
    }
    if (relic) {
      ctx.drawImage(RELIC_SPR, relic.x, relic.y);
      if ((time * 2 | 0) % 2) drawText('KLICK MICH!', relic.x + 8, relic.y - 10, '#a0a0ff', 1, 'center');
    }

    // Schüsse
    for (const s of shots) {
      if (s.kind === 'laser') {
        ctx.fillStyle = '#ff3030'; ctx.fillRect(Math.round(s.x), Math.round(s.y), s.w, s.h);
        ctx.fillStyle = '#ffd0d0'; ctx.fillRect(Math.round(s.x), Math.round(s.y) + 1, s.w, 1);
      } else ctx.drawImage(SPR.axe[(s.t * 14 | 0) % 4], Math.round(s.x), Math.round(s.y) - 1);
    }

    // Dynamit
    if (dyn) {
      ctx.drawImage(SPR.dyn, Math.round(dyn.x), Math.round(dyn.y));
      if ((time * 20 | 0) % 2) { ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(dyn.x + 1), Math.round(dyn.y) - 1, 1, 1); }
    }

    drawPlayer();

    // Partikel
    if (beam) {
      const a = Math.min(beam.x0, beam.x1), w = Math.abs(beam.x1 - beam.x0), f = 1 - beam.t / 0.35, y = Math.round(beam.y);
      ctx.globalAlpha = f * ((time * 40 | 0) % 2 ? 0.55 : 0.35);
      ctx.fillStyle = '#40c8f0'; ctx.fillRect(a, y - 2, w, 5);
      ctx.globalAlpha = f;
      ctx.fillStyle = '#d0ffff'; ctx.fillRect(a, y - 1, w, 3);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(a, y, w, 1);
      ctx.globalAlpha = 1;
    }
    for (const q of particles) {
      ctx.globalAlpha = q.t > q.life * 0.6 ? 0.6 : 1;
      ctx.fillStyle = q.col;
      ctx.fillRect(Math.round(q.x), Math.round(q.y), q.size, q.size);
    }
    ctx.globalAlpha = 1;
    for (const u of popups) drawText(u.text, u.x, Math.round(u.y), '#ffe060', 1, 'center');
    ctx.restore();

    if (flash > 0) { ctx.fillStyle = `rgba(255,240,200,${(flash / 0.12) * 0.35})`; ctx.fillRect(0, HUD, W, H - HUD); }
  }

  function drawPlayer() {
    if (state === 'dying') {
      if (stateT > 0.9) return;
      const s = (stateT * 16 | 0) % 2 ? SPR.hurt : SPR.hurt2;
      ctx.drawImage(s[p.face > 0 ? 0 : 1], Math.round(p.x - (p.face > 0 ? 3 : 3)), Math.round(p.y + p.h - 20 - stateT * 10));
      return;
    }
    if (p.inv > 0 && (time * 12 | 0) % 2) return;
    let s;
    if (p.duck) s = SPR.duck;
    else if (!p.onGround) s = SPR.fly;
    else if (Math.abs(p.vx) > 5) s = (p.anim * 8 | 0) % 2 ? SPR.walk : SPR.stand;
    else s = SPR.stand;
    const img = s[p.face > 0 ? 0 : 1];
    const dx = Math.round(p.x - 3), dy = Math.round(p.y + p.h - img.height);
    ctx.drawImage(img, dx, dy);
    // Flamme unter der Düse
    if (p.thrusting && p.spool > 0.15 && !p.duck) {
      const nx = p.face > 0 ? dx + 1 : dx + 12;
      const len = 2 + Math.floor(p.spool * 4) + ((time * 30 | 0) % 2);
      for (let i = 0; i < len; i++) {
        ctx.fillStyle = i < 2 ? '#fff4a0' : i < 4 ? '#ffb020' : '#e0401a';
        const wdt = i < len - 1 ? 3 : 1;
        ctx.fillRect(nx + (3 - wdt) / 2, dy + 17 + i, wdt, 1);
      }
    }
  }

  function drawHUD() {
    ctx.fillStyle = '#0c0814'; ctx.fillRect(0, 0, W, HUD);
    ctx.fillStyle = '#4a3a6a'; ctx.fillRect(0, HUD - 1, W, 1);
    drawText('PUNKTE', 4, 5, '#9a8ac0', 1, 'left', null);
    drawText(String(score).padStart(6, '0'), 31, 5, '#ffffff', 1, 'left', null);
    const bar = (label, lx, bx, v, col) => {
      drawText(label, lx, 5, '#9a8ac0', 1, 'left', null);
      ctx.fillStyle = '#2a2040'; ctx.fillRect(bx, 4, 42, 7);
      ctx.fillStyle = v > 25 ? col : (time * 4 | 0) % 2 ? '#ff4040' : '#a02020';
      ctx.fillRect(bx + 1, 5, Math.round(v * 0.4), 5);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(bx + 1, 5, Math.round(v * 0.4), 1);
    };
    bar('ENERGIE', 60, 89, p ? p.energy : 100, '#50d050');
    bar('TANK', 136, 154, p ? p.fuel : 100, '#f0a020');
    const d = p ? p.dyn : START_DYN;
    for (let i = 0; i < d; i++) ctx.drawImage(SPR.dynIcon, 208 + i * 5, 4);
    for (let i = 0; i < Math.min(lives, 6); i++) ctx.drawImage(SPR.life, 262 + i * 9, 4);
    drawText('ZEIT', 322, 5, '#9a8ac0', 1, 'left', null);
    drawText(clock(lvlT), 341, 5, lvlW && lvlT > parTime() ? '#ff8060' : '#ffffff', 1, 'left', null);
    drawText(mode === 'campaign' ? 'LEVEL ' + (levelIdx % LEVELS.length + 1) : mode === 'test' ? 'TESTLAUF' : 'CODE ' + curCode, W - 4, 5, '#ffffff', 1, 'right', null);
    if (round > 0) drawText('RUNDE ' + (round + 1), W - 48, 5, '#f0c040', 1, 'right', null);
  }

  function logo(x, y, sc, s = 'T.U.X.O.') {
    const c = canvas(textWidth(s, sc) + sc, 5 * sc + sc), g = c.getContext('2d');
    // Schrift in eigenen Puffer, dann mit Rasterstreifen einfärben (C64-Stil)
    drawInto(g, s, sc);
    // Streifen erst in eigenen Puffer: Chrome wendet source-in bei fillRect auf die ganze Fläche an
    // (jede Zeile würde die vorherigen löschen), drawImage über die volle Fläche ist überall gleich
    const st = canvas(c.width, c.height), sg = st.getContext('2d');
    const cols = ['#ffe060', '#ffb020', '#ff7020', '#e04020', '#c02060', '#8030a0', '#4050c0', '#30a0e0'];
    for (let yy = 0; yy < c.height; yy++) {
      sg.fillStyle = cols[Math.floor((yy / 3 + time * 6)) % cols.length];
      sg.fillRect(0, yy, c.width, 1);
    }
    g.globalCompositeOperation = 'source-in';
    g.drawImage(st, 0, 0);
    const sh = silhouette(c, '#000');
    ctx.drawImage(sh, x - c.width / 2 + sc, y + sc);
    ctx.drawImage(c, x - c.width / 2, y);
  }
  function drawInto(g, s, sc) {
    g.fillStyle = '#fff';
    let x = 0;
    for (const ch of s) {
      const gl = FONT[ch];
      if (gl) for (let b = 0; b < 15; b++) if (gl[b] === '1') g.fillRect(x + (b % 3) * sc, Math.floor(b / 3) * sc, sc, sc);
      x += 4 * sc;
    }
  }

  function drawBackdrop() {
    ctx.fillStyle = '#0c0814'; ctx.fillRect(0, 0, W, H);
    for (let x = -64; x < W + 64; x += 64) for (let y = 0; y < H; y += 64) ctx.drawImage(bgTile, x - Math.round(time * 10) % 64, y);
    ctx.fillStyle = 'rgba(8,4,14,0.55)'; ctx.fillRect(0, 0, W, H);
    // Rasterbalken
    for (let i = 0; i < 3; i++) {
      const y = 36 + Math.sin(time * 1.5 + i * 1.2) * 22;
      for (let j = 0; j < 7; j++) {
        ctx.fillStyle = ['#200830', '#501050', '#902060', '#e05050', '#902060', '#501050', '#200830'][j];
        ctx.fillRect(0, Math.round(y + j * 2), W, 2);
      }
    }
  }
  function drawTitle() {
    drawBackdrop();
    logo(W / 2, 22, 9);
    drawText(schnitzel ? 'EIN HÖHLENABENTEUER MIT SCHNITZEL' : 'EIN HÖHLENABENTEUER MIT TUX', W / 2, 82, '#f0c040', 1, 'center');
    // Tux fliegt durchs Bild
    const tx = ((time * 50) % (W + 60)) - 30, ty = 98 + Math.sin(time * 2.2) * 5;
    ctx.drawImage(SPR.fly[0], Math.round(tx), Math.round(ty));
    ctx.fillStyle = (time * 30 | 0) % 2 ? '#fff4a0' : '#ffb020';
    ctx.fillRect(Math.round(tx) + 1, Math.round(ty) + 17, 3, 4);
    ctx.drawImage(SPR.chick, W - 70, 106 + Math.round(-Math.abs(Math.sin(time * 5)) * 3));

    const lines = isTouch
      ? ['STEUERKREUZ: LAUFEN, FLIEGEN, DUCKEN', 'BOOM: DYNAMIT ABLEGEN']
      : ['PFEIL LINKS/RECHTS: LAUFEN    PFEIL HOCH: JETPACK', 'PFEIL RUNTER: DUCKEN    LEERTASTE: DYNAMIT', 'P: PAUSE    M: TON AN/AUS'];
    menuRects().forEach((r, i) => {
      const sel = i === menuSel;
      if (sel) { ctx.fillStyle = 'rgba(240,192,64,0.14)'; ctx.fillRect(r.x, r.y, r.w, r.h); }
      drawText(MENU[i], W / 2, r.y + 3, sel ? '#ffe060' : '#c8c0e0', 2, 'center');
      if (sel && (time * 3 | 0) % 2) { drawText('>', r.x - 4, r.y + 3, '#ffe060', 2, 'right'); drawText('<', r.x + r.w + 4, r.y + 3, '#ffe060', 2); }
    });
    lines.forEach((l, i) => drawText(l, W / 2, 196 + i * 10, '#9a8ac0', 1, 'center'));
    const best = board.list[0];
    drawText((best ? 'REKORD ' + pad6(best.score) + ' ' + best.name + '    ' : '') + 'DEIN BESTES ' + pad6(hiscore), W / 2, 232, '#50d050', 1, 'center');
    drawText('RETTE DIE PINGUIN-KÜKEN AUS DEN TIEFEN DES BERGES', W / 2, 246, '#8878a8', 1, 'center');
    drawText(Sound.muted ? 'TON AUS' : 'TON AN', W - 6, H - 10, '#665588', 1, 'right', null);
    drawText('HALL OF SHAME', W - 6, SHAME_BTN.y + 3, inRect(mouse, SHAME_BTN) ? '#ff7070' : '#a04848', 1, 'right');
    if (schFx && state === 'title') drawSchnitzelFx();
  }

  function dim(a) { ctx.fillStyle = `rgba(6,3,12,${a})`; ctx.fillRect(0, HUD, W, H - HUD); }
  function box(lines, cols, sc = 2) {
    const h = lines.length * (6 * sc + 4) + 14;
    const y = Math.round((HUD + H) / 2 - h / 2);
    ctx.fillStyle = 'rgba(10,6,20,0.9)'; ctx.fillRect(40, y, W - 80, h);
    ctx.fillStyle = '#f0c040'; ctx.fillRect(40, y, W - 80, 1); ctx.fillRect(40, y + h - 1, W - 80, 1);
    lines.forEach((l, i) => drawText(l, W / 2, y + 9 + i * (6 * sc + 4), cols[i] || '#fff', i === 0 ? sc : 1, 'center'));
  }

  function draw() {
    ctx.imageSmoothingEnabled = false;
    if (state === 'title') { drawTitle(); return; }
    if (state === 'editor') { drawEditor(); return; }
    if (state === 'share') { drawShare(); return; }
    if (state === 'codeinput') { drawCodeInput(); return; }
    if (state === 'busy') { drawBusy(); return; }
    if (state === 'nameentry') { drawNameEntry(); return; }
    if (state === 'witch') { drawWitch(); return; }
    if (state === 'shame') { drawShame(); return; }
    if (state === 'scores') { drawScores(); return; }
    if (state === 'gameover' && stateT > 0.6) {
      drawTitle();
      dim(0.75);
      box(['GAME OVER', '', 'PUNKTE ' + score, mode !== 'campaign' ? '' : board.status === 'loading' ? 'LADE BESTENLISTE ...' : board.status === 'ok' && qualifies(score) ? 'DU KOMMST IN DIE BESTENLISTE!' : 'DEIN BESTES ' + hiscore, '', 'ENTER ODER LEERTASTE'],
        ['#ff5050', '', '#fff', '#50d050', '', '#c8c0e0']);
      return;
    }
    if (state === 'victory') {
      ctx.fillStyle = '#0c0814'; ctx.fillRect(0, 0, W, H);
      drawHUD();
      for (const q of particles) { ctx.fillStyle = q.col; ctx.fillRect(Math.round(q.x), Math.round(q.y), 2, 2); }
      box(['ALLE KÜKEN GERETTET!', '', 'TUX IST EIN HELD.', 'ABER DER BERG HAT NOCH MEHR TIEFEN ...', '', 'RUNDE ' + (round + 1) + ': ALLES WIRD SCHNELLER'],
        ['#ffd050', '', '#fff', '#c8c0e0', '', '#ff9060']);
      for (const q of particles) { ctx.fillStyle = q.col; ctx.fillRect(Math.round(q.x), Math.round(q.y), 2, 2); }
      return;
    }
    drawWorld();
    drawHUD();
    if (mode === 'campaign' && curLevel && curLevel.ki) drawText('LEVEL VON ' + curLevel.ki, W - 4, H - 9, '#8878a8', 1, 'right');
    if (state === 'arkanoid') { drawArk(); return; }
    if (state === 'intro') {
      dim(Math.max(0, 0.7 - Math.max(0, stateT - 1.6)));
      if (mode === 'campaign') {
        drawText('LEVEL ' + (levelIdx % LEVELS.length + 1), W / 2, 96, '#f0c040', 3, 'center');
        drawText(curLevel.name, W / 2, 124, '#ffffff', 2, 'center');
        if (round > 0) drawText('RUNDE ' + (round + 1), W / 2, 146, '#ff9060', 1, 'center');
      } else {
        drawText(curLevel.name, W / 2, 100, '#f0c040', 3, 'center');
        drawText(mode === 'test' ? 'ESC: ZURÜCK ZUM EDITOR' : 'EIGENES LEVEL', W / 2, 130, '#ffffff', 1, 'center');
      }
    } else if (state === 'play' && p.empty && !paused) {
      if ((time * 2 | 0) % 2) drawText('TANK LEER - FESTGESTECKT? P: PAUSE, DANN NEU VERSUCHEN', W / 2, H - 12, '#f0a020', 1, 'center');
    } else if (state === 'dying' && p.deathReason && stateT > 0.3) {
      drawText(p.deathReason, W / 2, 120, '#ff6050', 2, 'center');
    } else if (state === 'clear') {
      dim(0.5);
      box(['KÜKEN GERETTET!', '', 'ENERGIE-BONUS  ' + tally.energyShown * 5, 'TANK-BONUS  ' + tally.fuelShown * 5, 'DYNAMIT-BONUS  ' + tally.dyn * 50,
        'ZEIT ' + clock(tally.time) + ' (SOLL ' + clock(tally.par) + ')  ZEIT-BONUS  ' + tally.tbShown, '', 'PUNKTE ' + score],
        ['#ffd050', '', '#50d050', '#f0a020', '#ff9060', '#60d0ff', '', '#ffffff']);
    } else if (state === 'gameover') {
      dim(stateT);
    } else if (state === 'customdone') {
      dim(0.6);
      panel(76, 116);
      drawText('GESCHAFFT!', W / 2, 90, '#ffd050', 3, 'center');
      drawText('CODE ' + curCode + '   -   PUNKTE ' + score, W / 2, 120, '#ffffff', 1, 'center');
      drawText('DAS KÜKEN IST GERETTET.', W / 2, 136, '#c8c0e0', 1, 'center');
      doneButtons().forEach(drawButton);
    }
    if (paused) {
      dim(0.6);
      drawText('PAUSE', W / 2, 108, '#ffffff', 4, 'center');
      pauseButtons().forEach(drawButton);
    }
  }

  // ---------- Start ----------
  function resize() {
    const s = Math.min(innerWidth / W, innerHeight / H);
    const si = s >= 1 ? Math.floor(s) : s;
    cv.style.width = W * si + 'px';
    cv.style.height = H * si + 'px';
  }
  addEventListener('resize', resize);
  resize();

  let last = performance.now(), accT = 0;
  function frame(now) {
    accT += Math.min(0.1, (now - last) / 1000);
    last = now;
    let n = 0;
    while (accT >= STEP && n < 6) { update(STEP); accT -= STEP; n++; }
    draw();
    requestAnimationFrame(frame);
  }

  // #K7M2QX lädt ein geteiltes Level; #level=3 startet direkt in Level 3 (zum Testen)
  function fromHash() {
    let h = '';
    try { h = decodeURIComponent(location.hash.slice(1)); } catch (e) { return; }
    const m = /^level=(\d+)$/.exec(h);
    if (h === 'c64') { // zum Ausprobieren: Level 3 mit C64-Android, Übungsrunde
      startGame(); run.practice = true;
      levelIdx = 2; forceC64 = true; loadLevel(levelIdx); return;
    }
    if (m) { // Übungsrunde: zählt nicht für die Bestenliste
      startGame(); run.practice = true;
      levelIdx = clamp(parseInt(m[1], 10) - 1, 0, LEVELS.length - 1); loadLevel(levelIdx); return;
    }
    if (/^[2-9A-HJKMNP-Z]{6}$/i.test(h)) loadByCode(h.toUpperCase());
  }
  setSkin(store.get('tuxo-schnitzel') === '1');
  fetchScores();
  addEventListener('hashchange', fromHash);
  fromHash();
  requestAnimationFrame(frame);
})();
