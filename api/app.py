#!/usr/bin/env python3
"""T.U.X.O. Level-API: speichert geteilte Level unter kurzen Codes.

Nur Standardbibliothek. Läuft hinter einem Reverse Proxy (/api/*), ohne eigenen Port nach außen.

    python app.py serve          HTTP-Dienst auf :8000 (oder TUXO_PORT)
    python app.py stats          Anzahl gespeicherter Level
    python app.py show CODE      Level als Text anzeigen (Moderation)
    python app.py delete CODE    Level löschen
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
        if self.path.split('?', 1)[0] != '/api/levels':
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


def main(argv):
    cmd = argv[1] if len(argv) > 1 else 'serve'
    init_db()
    if cmd == 'serve':
        port = int(os.environ.get('TUXO_PORT', '8000'))
        server = ThreadingHTTPServer(('0.0.0.0', port), Handler)
        server.daemon_threads = True
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
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
