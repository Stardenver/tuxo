#!/usr/bin/env python3
"""T.U.X.O. Level-API: speichert geteilte Level unter kurzen Codes und die globale Bestenliste.

Nur Standardbibliothek. Läuft hinter einem Reverse Proxy (/api/*), ohne eigenen Port nach außen.

    python app.py serve          HTTP-Dienst auf :8000 (oder TUXO_PORT)
    python app.py stats          Anzahl gespeicherter Level
    python app.py show CODE      Level als Text anzeigen (Moderation)
    python app.py delete CODE    Level löschen
    python app.py scores         Bestenliste mit IDs anzeigen (Moderation)
    python app.py delscore ID    Eintrag aus der Bestenliste löschen
    python app.py levels         Kampagnen-Level mit Punktegrenze und Mindestzeit (--json: Zeilen)

Bestenliste: Jede Kampagne holt sich beim Start eine Spielrunde (POST /api/runs). Ein Eintrag braucht eine
unverbrauchte Runde, die alt genug für die gemeldeten Level ist, und darf nicht mehr Punkte haben, als die
Level hergeben (berechnet aus public/levels.js). Fälschen bleibt möglich, aber nur noch mit plausiblen Werten.
"""
import hashlib
import ipaddress
import json
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DB_PATH = os.environ.get('TUXO_DB', '/data/levels.sqlite')
ROWS, MIN_W, MAX_W = 16, 30, 160
TILES = frozenset('.#XDLPC+*bswATR')
ENEMIES, ITEMS = frozenset('bswATR'), frozenset('+*')
MAX_ENEMIES, MAX_ITEMS = 60, 40
ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'  # ohne 0/O, 1/I/L
CODE_RE = re.compile(r'[2-9A-HJKMNP-Z]{6}')
MAX_BODY = 8 * 1024
MAX_LEVELS = 50_000
# (Zeitfenster in Sekunden, erlaubte Anfragen)
LIMIT_POST_IP = ((3600, 15), (86400, 40))
LIMIT_POST_ALL = ((86400, 1000),)
LIMIT_GET_IP = ((60, 60),)
# Bestenliste: Namen nur aus der Pixelschrift des Spiels, kurz gehalten (öffentlich sichtbar)
NAME_RE = re.compile(r'[A-Z0-9ÄÖÜ.!\- ]{1,10}')
TOP_N, KEEP_SCORES = 10, 100
MAX_SCORE = 10_000_000
LEVELS_PATH = os.environ.get('TUXO_LEVELS', '/app/public/levels.js')
# Punkte wie in game.js: Monster (pts), Edelstein, gesprengte Wand bzw. Tür (je zusammenhängender Block)
ENEMY_PTS = {'b': 50, 's': 75, 'w': 50, 'T': 150, 'R': 150, 'A': 200}
GEM_PTS, WALL_PTS = 250, {'X': 75, 'D': 100}
# Abrechnung nach dem Küken: Energie (max. 100 × 10), Dynamit (max. 9 × 50), Zeitbonus (Sollzeit × 20)
ENERGY_PTS, DYN_PTS, PAR_PER_COL, TIME_PTS = 1000, 9 * 50, 0.8, 20
# Mindestzeit: schnellster Flug 92 px/s vom Start zum Küken, dazu Einblendung (0,5 s) und Abrechnung (3,4 s)
TS, MAX_SPEED, LEVEL_OVERHEAD, VICTORY_MIN = 16, 92, 3.9, 2.0
TIME_SLACK = 0.9  # die Runde wird erst kurz nach dem Spielstart angelegt
RUN_MAX_AGE, MAX_RUNS = 12 * 3600, 50_000
RUN_RE = re.compile(r'[A-Za-z0-9_-]{22}')
LIMIT_RUN_IP = ((3600, 60), (86400, 300))
LIMIT_RUN_ALL = ((86400, 20_000),)
LIMIT_SCORE_IP = ((3600, 10), (86400, 30))
LIMIT_SCORE_ALL = ((86400, 2000),)


class Limiter:
    """Gleitende Zeitfenster im Arbeitsspeicher. IP-Adressen werden nie gespeichert."""

    def __init__(self):
        self.lock = threading.Lock()
        self.hits = {}

    def allow(self, key, rules):
        now = time.monotonic()
        with self.lock:
            if len(self.hits) > 20_000:
                self._gc(now)
            q = self.hits.setdefault(key, deque())
            longest = max(w for w, _ in rules)
            while q and now - q[0] > longest:
                q.popleft()
            for window, limit in rules:
                if sum(1 for t in q if now - t <= window) >= limit:
                    return False
            q.append(now)
            return True

    def _gc(self, now):
        for k in [k for k, q in self.hits.items() if not q or now - q[-1] > 86400]:
            del self.hits[k]
        if len(self.hits) > 20_000:
            self.hits.clear()


limiter = Limiter()


def client_key(handler):
    # Caddy ersetzt einen von außen mitgeschickten X-Forwarded-For durch die echte Adresse
    ip = handler.headers.get('X-Forwarded-For', '').split(',')[-1].strip() or handler.client_address[0]
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return 'unbekannt'
    if a.version == 6 and a.ipv4_mapped:
        a = a.ipv4_mapped
    if a.version == 6:  # ein Anschluss hat meist ein ganzes /64
        return str(ipaddress.ip_network(f'{a}/64', strict=False))
    return str(a)


def validate(rows):
    """Gleiche Regeln wie checkRows() in game.js. Gibt eine Fehlermeldung oder None zurück."""
    if not isinstance(rows, list) or len(rows) != ROWS or not all(isinstance(r, str) for r in rows):
        return 'UNGÜLTIGES LEVEL'
    w = len(rows[0])
    if not MIN_W <= w <= MAX_W:
        return 'UNGÜLTIGE LÄNGE'
    if any(len(r) != w for r in rows):
        return 'UNGÜLTIGES LEVEL'
    start = goal = None
    enemies = items = 0
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch not in TILES:
                return 'UNGÜLTIGES ZEICHEN'
            if ch == 'P':
                if start:
                    return 'NUR EIN START ERLAUBT'
                start = (x, y)
            elif ch == 'C':
                if goal:
                    return 'NUR EIN KÜKEN ERLAUBT'
                goal = (x, y)
            elif ch in ENEMIES:
                enemies += 1
            elif ch in ITEMS:
                items += 1
    if not start:
        return 'START (TUX) FEHLT'
    if not goal:
        return 'KÜKEN FEHLT'
    if enemies > MAX_ENEMIES:
        return f'HÖCHSTENS {MAX_ENEMIES} MONSTER'
    if items > MAX_ITEMS:
        return f'HÖCHSTENS {MAX_ITEMS} GEGENSTÄNDE'

    def open_(x, y):
        return 0 <= x < w and 0 <= y < ROWS and rows[y][x] not in '#L'

    if not open_(start[0], start[1] - 1):
        return 'ÜBER DEM START FEHLT PLATZ'
    # Breitensuche: Tux belegt 1x2 Kacheln, sprengbare Wände gelten als offen
    seen, queue = {start}, deque([start])
    while queue:
        x, y = queue.popleft()
        if x == goal[0] and y in (goal[1], goal[1] + 1):
            return None
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (x + dx, y + dy)
            if n not in seen and open_(*n) and open_(n[0], n[1] - 1):
                seen.add(n)
                queue.append(n)
    return 'KÜKEN IST NICHT ERREICHBAR'


def level_info(rows):
    """Höchstpunktzahl (im Level und mit Abrechnung) und Mindestzeit eines Levels."""
    w = len(rows[0])
    pts = sum(ENEMY_PTS.get(ch, 0) + (GEM_PTS if ch == '*' else 0) for r in rows for ch in r)
    seen = set()
    for y in range(ROWS):
        for x in range(w):
            ch = rows[y][x]
            if ch not in WALL_PTS or (x, y) in seen:
                continue
            pts += WALL_PTS[ch]  # ein Block zerfällt als Ganzes und bringt nur einmal Punkte
            seen.add((x, y))
            stack = [(x, y)]
            while stack:
                cx, cy = stack.pop()
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < w and 0 <= ny < ROWS and (nx, ny) not in seen and rows[ny][nx] == ch:
                        seen.add((nx, ny))
                        stack.append((nx, ny))
    col = {ch: x for r in rows for x, ch in enumerate(r) if ch in 'PC'}
    full = pts + ENERGY_PTS + DYN_PTS + round(w * PAR_PER_COL) * TIME_PTS
    return {'width': w, 'partial': pts, 'full': full,
            'min_time': abs(col['C'] - col['P']) * TS / MAX_SPEED + LEVEL_OVERHEAD}


def parse_levels(src):
    """Liest die Abschnitte jedes Levels aus levels.js und setzt sie zu 16 Zeilen zusammen."""
    levels = []
    for m in re.finditer(r'segments:\s*\[', src):
        depth, i = 1, m.end()
        while depth:  # passende schließende Klammer; die Zeichenketten enthalten nur Kacheln und Ziffern
            depth += {'[': 1, ']': -1}.get(src[i], 0)
            i += 1
        strs = re.findall(r"'([^'\\]*)'", src[m.end():i])
        if not strs or len(strs) % ROWS:
            raise ValueError('levels.js: Abschnitt ohne 16 Zeilen')
        segs = [strs[k:k + ROWS] for k in range(0, len(strs), ROWS)]
        rows = [re.sub('[1-9]', '.', ''.join(s[r] for s in segs)) for r in range(ROWS)]
        err = validate(rows)
        if err:
            raise ValueError(f'levels.js: Level {len(levels) + 1}: {err}')
        levels.append(rows)
    if not levels:
        raise ValueError('levels.js: keine Level gefunden')
    return levels


_campaign = {'mtime': None, 'levels': [], 'info': []}
_campaign_lock = threading.Lock()


def campaign():
    """Grenzen der Kampagnen-Level; levels.js wird neu gelesen, sobald sich die Datei ändert."""
    with _campaign_lock:
        mtime = os.stat(LEVELS_PATH).st_mtime_ns
        if mtime != _campaign['mtime']:
            with open(LEVELS_PATH, encoding='utf-8') as f:
                levels = parse_levels(f.read())
            _campaign.update(mtime=mtime, levels=levels, info=[level_info(r) for r in levels])
        return _campaign['info']


def score_limits(levels):
    """(Höchstpunktzahl, Mindestzeit in s) nach `levels` geschafften Leveln; die Kampagne wiederholt sich."""
    info = campaign()
    rounds, rest = divmod(levels, len(info))
    best = rounds * sum(i['full'] for i in info) + sum(i['full'] for i in info[:rest]) + info[rest]['partial']
    need = rounds * (sum(i['min_time'] for i in info) + VICTORY_MIN) + sum(i['min_time'] for i in info[:rest])
    return best, need


def db():
    con = sqlite3.connect(DB_PATH, timeout=5)
    con.execute('PRAGMA busy_timeout = 5000')
    return con


def init_db():
    con = db()
    with con:
        con.execute('PRAGMA journal_mode = WAL')
        con.execute('''CREATE TABLE IF NOT EXISTS levels (
            code TEXT PRIMARY KEY,
            hash TEXT NOT NULL UNIQUE,
            data TEXT NOT NULL,
            created INTEGER NOT NULL)''')
        con.execute('''CREATE TABLE IF NOT EXISTS scores (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            score INTEGER NOT NULL,
            levels INTEGER NOT NULL,
            created INTEGER NOT NULL)''')
        con.execute('''CREATE TABLE IF NOT EXISTS runs (
            token TEXT PRIMARY KEY,
            created REAL NOT NULL)''')
    con.close()


def new_run():
    """Legt eine Spielrunde an und gibt ihr Token zurück (None, wenn zu viele offen sind)."""
    con = db()
    try:
        with con:
            now = time.time()
            con.execute('DELETE FROM runs WHERE created < ?', (now - RUN_MAX_AGE,))
            if con.execute('SELECT COUNT(*) FROM runs').fetchone()[0] >= MAX_RUNS:
                return None
            token = secrets.token_urlsafe(16)
            con.execute('INSERT INTO runs (token, created) VALUES (?, ?)', (token, now))
        return token
    finally:
        con.close()


def take_run(token):
    """Verbraucht eine Spielrunde und gibt ihr Alter in Sekunden zurück (None, wenn unbekannt oder abgelaufen)."""
    if not isinstance(token, str) or not RUN_RE.fullmatch(token):
        return None
    con = db()
    try:
        with con:
            row = con.execute('SELECT created FROM runs WHERE token = ?', (token,)).fetchone()
            # nur wer die Zeile wirklich löscht, darf sie verwenden (gleichzeitige Einträge)
            if not row or not con.execute('DELETE FROM runs WHERE token = ?', (token,)).rowcount:
                return None
        age = time.time() - row[0]
        return age if age <= RUN_MAX_AGE else None
    finally:
        con.close()


def store_level(rows):
    """Gibt (code, neu) zurück. Gleiche Level bekommen denselben Code."""
    data = '\n'.join(rows)
    digest = hashlib.sha256(data.encode()).hexdigest()
    con = db()
    try:
        row = con.execute('SELECT code FROM levels WHERE hash = ?', (digest,)).fetchone()
        if row:
            return row[0], False
        if con.execute('SELECT COUNT(*) FROM levels').fetchone()[0] >= MAX_LEVELS:
            return None, False
        for _ in range(20):
            code = ''.join(secrets.choice(ALPHABET) for _ in range(6))
            try:
                with con:
                    con.execute('INSERT INTO levels (code, hash, data, created) VALUES (?, ?, ?, ?)',
                                (code, digest, data, int(time.time())))
                return code, True
            except sqlite3.IntegrityError:
                row = con.execute('SELECT code FROM levels WHERE hash = ?', (digest,)).fetchone()
                if row:  # gleichzeitig von jemand anderem gespeichert
                    return row[0], False
        raise RuntimeError('kein freier Code gefunden')
    finally:
        con.close()


def load_level(code):
    con = db()
    try:
        row = con.execute('SELECT data FROM levels WHERE code = ?', (code,)).fetchone()
        return row[0].split('\n') if row else None
    finally:
        con.close()


def clean_name(name):
    """Großbuchstaben, Leerraum zusammengefasst. Gibt None zurück, wenn der Name unzulässig ist."""
    if not isinstance(name, str):
        return None
    name = ' '.join(name.upper().split())
    return name if NAME_RE.fullmatch(name) else None


def validate_score(payload):
    """Gibt (name, score, levels) oder eine Fehlermeldung zurück."""
    if not isinstance(payload, dict):
        return 'UNGÜLTIGE DATEN'
    name, score, levels = clean_name(payload.get('name')), payload.get('score'), payload.get('levels')
    if not name:
        return 'UNGÜLTIGER NAME'
    if type(score) is not int or type(levels) is not int or not 0 <= levels <= 10_000:
        return 'UNGÜLTIGE PUNKTZAHL'
    # Die Runde wird auch bei abgelehnten Punkten verbraucht – ein ehrliches Spiel scheitert daran nie
    age = take_run(payload.get('run'))
    if age is None:
        return 'SPIELRUNDE UNGÜLTIG - BITTE NEU SPIELEN'
    try:
        best, need = score_limits(levels)
    except (OSError, ValueError) as e:
        print(f'Bestenliste: {e}', flush=True)
        return 'BESTENLISTE GERADE NICHT VERFÜGBAR'
    if not 0 < score <= min(MAX_SCORE, best) or age < need * TIME_SLACK:
        return 'UNGÜLTIGE PUNKTZAHL'
    return name, score, levels


def top_scores(con):
    rows = con.execute('SELECT name, score, levels FROM scores ORDER BY score DESC, id ASC LIMIT ?', (TOP_N,)).fetchall()
    return [{'name': n, 'score': s, 'levels': l} for n, s, l in rows]


def store_score(name, score, levels):
    """Trägt ein und gibt (Platz oder None, Top 10) zurück. Gleichstand: der frühere Eintrag steht oben."""
    con = db()
    try:
        with con:
            cur = con.execute('INSERT INTO scores (name, score, levels, created) VALUES (?, ?, ?, ?)',
                              (name, score, levels, int(time.time())))
            new_id = cur.lastrowid
            con.execute('''DELETE FROM scores WHERE id NOT IN
                (SELECT id FROM scores ORDER BY score DESC, id ASC LIMIT ?)''', (KEEP_SCORES,))
        rank = con.execute('SELECT COUNT(*) FROM scores WHERE score > ? OR (score = ? AND id < ?)',
                           (score, score, new_id)).fetchone()[0] + 1
        return (rank if rank <= TOP_N else None), top_scores(con)
    finally:
        con.close()


def load_scores():
    con = db()
    try:
        return top_scores(con)
    finally:
        con.close()


class Handler(BaseHTTPRequestHandler):
    server_version = 'tuxo'
    sys_version = ''
    timeout = 10

    def log_message(self, fmt, *args):
        pass  # keine IP-Adressen ins Log; Caddy protokolliert bereits

    def send_json(self, status, obj, headers=None):
        body = json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def too_many(self, msg):
        self.send_json(429, {'error': msg}, {'Retry-After': '3600'})

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path == '/api/health':
            return self.send_json(200, {'ok': True})
        if path == '/api/scores':
            if not limiter.allow(('get', client_key(self)), LIMIT_GET_IP):
                return self.too_many('ZU VIELE ANFRAGEN - BITTE KURZ WARTEN')
            return self.send_json(200, {'scores': load_scores()})
        m = re.fullmatch(r'/api/levels/([2-9A-HJKMNP-Z]{6})', path)
        if not m:
            return self.send_json(404, {'error': 'NICHT GEFUNDEN'})
        if not limiter.allow(('get', client_key(self)), LIMIT_GET_IP):
            return self.too_many('ZU VIELE ANFRAGEN - BITTE KURZ WARTEN')
        rows = load_level(m.group(1))
        if not rows:
            return self.send_json(404, {'error': 'CODE NICHT GEFUNDEN'})
        self.send_json(200, {'code': m.group(1), 'rows': rows})

    def do_POST(self):
        path = self.path.split('?', 1)[0]
        if path == '/api/scores':
            return self.post_score()
        if path == '/api/runs':
            if not limiter.allow(('run', client_key(self)), LIMIT_RUN_IP):
                return self.too_many('ZU VIELE SPIELE - BITTE SPÄTER NOCHMAL')
            token = limiter.allow(('run', '*'), LIMIT_RUN_ALL) and new_run()
            if not token:
                return self.too_many('HEUTE WERDEN KEINE SPIELE MEHR GEZÄHLT')
            return self.send_json(201, {'run': token})
        if path != '/api/levels':
            return self.send_json(404, {'error': 'NICHT GEFUNDEN'})
        if self.headers.get_content_type() != 'application/json':
            return self.send_json(415, {'error': 'NUR JSON'})
        try:
            length = int(self.headers.get('Content-Length', ''))
        except ValueError:
            return self.send_json(411, {'error': 'LÄNGE FEHLT'})
        if not 0 < length <= MAX_BODY:
            return self.send_json(413, {'error': 'LEVEL ZU GROSS'})
        # Auch ungültige Versuche zählen, damit niemand den Server mit Müll beschäftigt
        if not limiter.allow(('post', client_key(self)), LIMIT_POST_IP):
            return self.too_many('ZU VIELE LEVEL GETEILT - BITTE SPÄTER NOCHMAL')
        if not limiter.allow(('post', '*'), LIMIT_POST_ALL):
            return self.too_many('HEUTE WERDEN KEINE LEVEL MEHR ANGENOMMEN')
        try:
            payload = json.loads(self.rfile.read(length))
        except (ValueError, UnicodeDecodeError):
            return self.send_json(400, {'error': 'UNGÜLTIGE DATEN'})
        rows = payload.get('rows') if isinstance(payload, dict) else None
        err = validate(rows)
        if err:
            return self.send_json(400, {'error': err})
        code, new = store_level(rows)
        if not code:
            return self.send_json(507, {'error': 'DER LEVELSPEICHER IST VOLL'})
        self.send_json(201 if new else 200, {'code': code})

    def post_score(self):
        if self.headers.get_content_type() != 'application/json':
            return self.send_json(415, {'error': 'NUR JSON'})
        try:
            length = int(self.headers.get('Content-Length', ''))
        except ValueError:
            return self.send_json(411, {'error': 'LÄNGE FEHLT'})
        if not 0 < length <= 512:
            return self.send_json(413, {'error': 'UNGÜLTIGE DATEN'})
        if not limiter.allow(('score', client_key(self)), LIMIT_SCORE_IP):
            return self.too_many('ZU VIELE EINTRÄGE - BITTE SPÄTER NOCHMAL')
        if not limiter.allow(('score', '*'), LIMIT_SCORE_ALL):
            return self.too_many('HEUTE WERDEN KEINE EINTRÄGE MEHR ANGENOMMEN')
        try:
            payload = json.loads(self.rfile.read(length))
        except (ValueError, UnicodeDecodeError):
            return self.send_json(400, {'error': 'UNGÜLTIGE DATEN'})
        res = validate_score(payload)
        if isinstance(res, str):
            return self.send_json(400, {'error': res})
        rank, scores = store_score(*res)
        self.send_json(201, {'rank': rank, 'scores': scores})


def main(argv):
    cmd = argv[1] if len(argv) > 1 else 'serve'
    init_db()
    if cmd == 'serve':
        port = int(os.environ.get('TUXO_PORT', '8000'))
        server = ThreadingHTTPServer(('0.0.0.0', port), Handler)
        server.daemon_threads = True
        try:
            print(f'{len(campaign())} Kampagnen-Level aus {LEVELS_PATH}', flush=True)
        except (OSError, ValueError) as e:  # Level teilen geht trotzdem, nur Einträge werden abgelehnt
            print(f'WARNUNG: {e}', flush=True)
        print(f'tuxo-api läuft auf :{port}', flush=True)
        server.serve_forever()
    elif cmd == 'stats':
        con = db()
        n, last = con.execute('SELECT COUNT(*), MAX(created) FROM levels').fetchone()
        print(f'{n} Level gespeichert' + (f', zuletzt {time.strftime("%d.%m.%Y %H:%M", time.gmtime(last))} UTC' if last else ''))
    elif cmd in ('show', 'delete') and len(argv) == 3 and CODE_RE.fullmatch(argv[2].upper()):
        code = argv[2].upper()
        if cmd == 'show':
            rows = load_level(code)
            print('\n'.join(rows) if rows else 'nicht gefunden')
        else:
            con = db()
            with con:
                n = con.execute('DELETE FROM levels WHERE code = ?', (code,)).rowcount
            print(f'{code} gelöscht' if n else 'nicht gefunden')
    elif cmd == 'scores':
        con = db()
        rows = con.execute('SELECT id, name, score, levels, created FROM scores ORDER BY score DESC, id ASC').fetchall()
        for i, (sid, name, score, levels, created) in enumerate(rows, 1):
            print(f'{i:3}. {name:<10} {score:>8}  Level {levels:<3} ID {sid}  {time.strftime("%d.%m.%Y %H:%M", time.gmtime(created))} UTC')
        if not rows:
            print('Bestenliste ist leer')
    elif cmd == 'levels':
        for i, info in enumerate(campaign(), 1):
            print(f'Level {i}: {info["width"]} Spalten, bis {info["partial"]} Punkte im Level, '
                  f'{info["full"]} mit Abrechnung, mindestens {info["min_time"]:.1f} s')
        if '--json' in argv:
            print(json.dumps(_campaign['levels'], separators=(',', ':')))
    elif cmd == 'delscore' and len(argv) == 3 and argv[2].isdigit():
        con = db()
        with con:
            n = con.execute('DELETE FROM scores WHERE id = ?', (int(argv[2]),)).rowcount
        print(f'Eintrag {argv[2]} gelöscht' if n else 'nicht gefunden')
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
