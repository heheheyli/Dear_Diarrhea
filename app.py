"""Dear Diarrhea: Flask + SQLite, runs on localhost only.

Run:  python app.py            (or double-click journal.bat)
Reset a forgotten PIN:  python app.py --reset-pin
"""
import calendar
import io
import logging
import os
import re
import socket
import sqlite3
import sys
import threading
import uuid
import webbrowser
import zipfile
from datetime import date, datetime, timedelta
from functools import wraps
from html import unescape

from flask import (Flask, abort, g, jsonify, redirect, render_template, request,
                   send_file, send_from_directory, session, url_for)
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
PHOTO_DIR = os.path.join(DATA_DIR, "photos")
DB_PATH = os.path.join(DATA_DIR, "journal.db")
HOST, PORT = "127.0.0.1", 7777
IMAGE_EXTS = {"jpg", "jpeg", "png", "gif", "webp"}
MOODS = {1: "ugh", 2: "meh", 3: "okay", 4: "good", 5: "yay"}
# SQLite's trim() only strips spaces by default, so strip tabs/newlines too.
NONEMPTY = "trim(content, ' ' || char(9) || char(10) || char(13)) != ''"

app = Flask(__name__)
app.secret_key = os.urandom(32)  # new key every launch, so the PIN is asked each time
app.config["MAX_CONTENT_LENGTH"] = 30 * 1024 * 1024

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS days (date TEXT PRIMARY KEY, mood INTEGER);
CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    created_at TEXT NOT NULL
);
"""


# ---------- helpers ----------

def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    os.makedirs(PHOTO_DIR, exist_ok=True)
    with sqlite3.connect(DB_PATH) as con:
        con.executescript(SCHEMA)


def get_setting(key):
    row = get_db().execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else None


def set_setting(key, value):
    db = get_db()
    db.execute("INSERT INTO settings(key, value) VALUES(?, ?) "
               "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))
    db.commit()


def now_iso():
    return datetime.now().isoformat(timespec="seconds")


def plain(content):
    """Entries are stored as HTML from the editor; strip tags for counts, search, snippets."""
    text = re.sub(r"<(br|/p|/div|/li|/h\d|/blockquote)\s*/?>", "\n", content, flags=re.I)
    return unescape(re.sub(r"<[^>]+>", "", text))


def word_count(text):
    return len(plain(text).split())


def parse_date(s):
    try:
        return date.fromisoformat(s)
    except ValueError:
        abort(400)


def body():
    # force=True so sendBeacon (text/plain) payloads still parse
    return request.get_json(force=True, silent=True) or {}


def snippet(text, length=220):
    text = re.sub(r"\s+", " ", plain(text)).strip()
    return text if len(text) <= length else text[:length].rsplit(" ", 1)[0] + "…"


def months_back(d, n):
    y, m = divmod(d.month - 1 - n, 12)
    y += d.year
    m += 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def photo_url(filename):
    return url_for("photo_file", filename=filename)


def entry_dict(row, db):
    photos = db.execute("SELECT id, filename FROM photos WHERE entry_id=? ORDER BY id",
                        (row["id"],)).fetchall()
    return {
        "id": row["id"], "date": row["date"], "content": row["content"],
        "created_at": row["created_at"], "updated_at": row["updated_at"],
        "photos": [{"id": p["id"], "url": photo_url(p["filename"])} for p in photos],
    }


def remove_photo_files(db, entry_id):
    for p in db.execute("SELECT filename FROM photos WHERE entry_id=?", (entry_id,)):
        try:
            os.remove(os.path.join(PHOTO_DIR, p["filename"]))
        except FileNotFoundError:
            pass


# ---------- auth ----------

def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not session.get("ok"):
            if request.path.startswith("/api/"):
                return jsonify(error="locked"), 401
            return redirect(url_for("lock"))
        return f(*args, **kwargs)
    return wrapper


@app.route("/lock", methods=["GET", "POST"])
def lock():
    pin_hash = get_setting("pin_hash")
    error = None
    if request.method == "POST":
        pin = request.form.get("pin", "").strip()
        if pin_hash is None:
            confirm = request.form.get("confirm", "").strip()
            if not re.fullmatch(r"\d{4,8}", pin):
                error = "Pin needs 4–8 digits."
            elif pin != confirm:
                error = "Those don't match."
            else:
                set_setting("pin_hash", generate_password_hash(pin))
                session["ok"] = True
                return redirect("/")
        elif check_password_hash(pin_hash, pin):
            session["ok"] = True
            return redirect("/")
        else:
            error = "That's not the one."
    return render_template("lock.html", setup=pin_hash is None, error=error)


@app.post("/api/lock")
def api_lock():
    session.clear()
    return jsonify(ok=True)


# ---------- pages ----------

@app.get("/")
@login_required
def index():
    return render_template("index.html")


@app.get("/photos/<path:filename>")
@login_required
def photo_file(filename):
    return send_from_directory(PHOTO_DIR, filename)


@app.get("/logo.svg")
def logo_svg():
    return send_from_directory(os.path.join(BASE_DIR, "logo"), "logo.svg", mimetype="image/svg+xml")


# ---------- days & entries ----------

def on_this_day(db, d):
    targets = [("1 month ago", months_back(d, 1))]
    for yrs in range(1, 11):
        try:
            targets.append((f"{yrs} year{'s' if yrs > 1 else ''} ago", d.replace(year=d.year - yrs)))
        except ValueError:  # 29 Feb
            pass
    out = []
    for label, t in targets:
        ts = t.isoformat()
        rows = db.execute(f"SELECT content FROM entries WHERE date=? AND {NONEMPTY} "
                          "ORDER BY created_at", (ts,)).fetchall()
        if rows:
            mood = db.execute("SELECT mood FROM days WHERE date=?", (ts,)).fetchone()
            out.append({"label": label, "date": ts,
                        "snippet": snippet(" ".join(r["content"] for r in rows)),
                        "mood": mood["mood"] if mood else None})
    return out


@app.get("/api/day/<d>")
@login_required
def get_day(d):
    d = parse_date(d)
    ds = d.isoformat()
    db = get_db()
    # drop entries that were opened but never written in (and have no photos)
    db.execute(f"DELETE FROM entries WHERE date=? AND NOT ({NONEMPTY}) "
               "AND id NOT IN (SELECT entry_id FROM photos)", (ds,))
    db.commit()
    rows = db.execute("SELECT * FROM entries WHERE date=? ORDER BY created_at, id", (ds,)).fetchall()
    mood = db.execute("SELECT mood FROM days WHERE date=?", (ds,)).fetchone()
    return jsonify(date=ds, mood=mood["mood"] if mood else None,
                   entries=[entry_dict(r, db) for r in rows],
                   on_this_day=on_this_day(db, d))


@app.put("/api/day/<d>/mood")
@login_required
def set_mood(d):
    ds = parse_date(d).isoformat()
    mood = body().get("mood")
    if mood is not None and mood not in MOODS:
        abort(400)
    db = get_db()
    db.execute("INSERT INTO days(date, mood) VALUES(?, ?) "
               "ON CONFLICT(date) DO UPDATE SET mood=excluded.mood", (ds, mood))
    db.commit()
    return jsonify(ok=True)


@app.post("/api/day/<d>/entries")
@login_required
def create_entry(d):
    ds = parse_date(d).isoformat()
    content = str(body().get("content", ""))
    ts = now_iso()
    db = get_db()
    cur = db.execute("INSERT INTO entries(date, content, created_at, updated_at) VALUES (?,?,?,?)",
                     (ds, content, ts, ts))
    db.commit()
    row = db.execute("SELECT * FROM entries WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify(entry_dict(row, db)), 201


@app.route("/api/entries/<int:eid>", methods=["PUT", "POST"])  # POST for sendBeacon
@login_required
def update_entry(eid):
    content = str(body().get("content", ""))
    db = get_db()
    cur = db.execute("UPDATE entries SET content=?, updated_at=? WHERE id=?", (content, now_iso(), eid))
    db.commit()
    if cur.rowcount == 0:
        abort(404)
    return jsonify(ok=True)


@app.delete("/api/entries/<int:eid>")
@login_required
def delete_entry(eid):
    db = get_db()
    remove_photo_files(db, eid)
    db.execute("DELETE FROM entries WHERE id=?", (eid,))
    db.commit()
    return jsonify(ok=True)


# ---------- photos ----------

@app.post("/api/entries/<int:eid>/photos")
@login_required
def upload_photos(eid):
    db = get_db()
    if not db.execute("SELECT 1 FROM entries WHERE id=?", (eid,)).fetchone():
        abort(404)
    out = []
    for f in request.files.getlist("photo"):
        ext = f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else ""
        if ext not in IMAGE_EXTS:
            continue
        name = f"{uuid.uuid4().hex}.{ext}"
        f.save(os.path.join(PHOTO_DIR, name))
        cur = db.execute("INSERT INTO photos(entry_id, filename, created_at) VALUES (?,?,?)",
                         (eid, name, now_iso()))
        out.append({"id": cur.lastrowid, "url": photo_url(name)})
    db.commit()
    if not out:
        return jsonify(error="Only jpg, png, gif or webp images are supported."), 400
    return jsonify(photos=out), 201


@app.delete("/api/photos/<int:pid>")
@login_required
def delete_photo(pid):
    db = get_db()
    row = db.execute("SELECT filename FROM photos WHERE id=?", (pid,)).fetchone()
    if row:
        try:
            os.remove(os.path.join(PHOTO_DIR, row["filename"]))
        except FileNotFoundError:
            pass
        db.execute("DELETE FROM photos WHERE id=?", (pid,))
        db.commit()
    return jsonify(ok=True)


# ---------- calendar, stats, search ----------

@app.get("/api/calendar/<ym>")
@login_required
def month(ym):
    if not re.fullmatch(r"\d{4}-\d{2}", ym):
        abort(400)
    db = get_db()
    days = {}
    for r in db.execute(f"SELECT date, content FROM entries WHERE date LIKE ? AND {NONEMPTY}", (ym + "-%",)):
        days.setdefault(r["date"], {"words": 0, "mood": None})["words"] += word_count(r["content"])
    for r in db.execute("SELECT date, mood FROM days WHERE date LIKE ? AND mood IS NOT NULL", (ym + "-%",)):
        days.setdefault(r["date"], {"words": 0, "mood": None})["mood"] = r["mood"]
    return jsonify(days=days)


@app.get("/api/stats")
@login_required
def stats():
    db = get_db()
    today = date.today()
    dates = sorted({date.fromisoformat(r[0]) for r in
                    db.execute(f"SELECT DISTINCT date FROM entries WHERE {NONEMPTY}")})
    written = set(dates)

    current = 0
    d = today if today in written else today - timedelta(days=1)
    while d in written:
        current += 1
        d -= timedelta(days=1)

    longest = run = 0
    prev = None
    for d in dates:
        run = run + 1 if prev and (d - prev).days == 1 else 1
        longest = max(longest, run)
        prev = d

    contents = [r[0] for r in db.execute(f"SELECT content FROM entries WHERE {NONEMPTY}")]
    words = sum(word_count(c) for c in contents)
    start = (today - timedelta(days=89)).isoformat()
    moods = [{"date": r["date"], "mood": r["mood"]} for r in db.execute(
        "SELECT date, mood FROM days WHERE mood IS NOT NULL AND date BETWEEN ? AND ? ORDER BY date",
        (start, today.isoformat()))]
    counts = {str(k): 0 for k in MOODS}
    for r in db.execute("SELECT mood, COUNT(*) AS c FROM days WHERE mood IS NOT NULL GROUP BY mood"):
        counts[str(r["mood"])] = r["c"]

    return jsonify(current_streak=current, longest_streak=longest, written_today=today in written,
                   days_written=len(dates), entries=len(contents), words=words,
                   avg_words=round(words / len(dates)) if dates else 0,
                   moods=moods, mood_counts=counts, today=today.isoformat())


@app.get("/api/search")
@login_required
def search():
    q = request.args.get("q", "").strip()
    if len(q) < 2:
        return jsonify(results=[])
    rows = get_db().execute(
        f"SELECT id, date, content, created_at FROM entries WHERE {NONEMPTY} "
        "ORDER BY date DESC, created_at DESC").fetchall()
    results = []
    for r in rows:
        text = plain(r["content"])
        i = text.lower().find(q.lower())
        if i < 0:
            continue
        if len(results) >= 100:
            break
        start, end = max(0, i - 80), i + len(q) + 140
        snip = re.sub(r"\s+", " ", text[start:end]).strip()
        results.append({"id": r["id"], "date": r["date"], "created_at": r["created_at"],
                        "snippet": ("…" if start > 0 else "") + snip + ("…" if end < len(text) else "")})
    return jsonify(results=results)


# ---------- export ----------

@app.get("/api/export")
@login_required
def export():
    db = get_db()
    moods = {r["date"]: r["mood"] for r in db.execute("SELECT date, mood FROM days WHERE mood IS NOT NULL")}
    by_day = {}
    for r in db.execute(f"SELECT * FROM entries WHERE {NONEMPTY} OR id IN (SELECT entry_id FROM photos) "
                        "ORDER BY date, created_at, id"):
        by_day.setdefault(r["date"], []).append(r)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for ds, rows in by_day.items():
            d = date.fromisoformat(ds)
            title = f"{d.strftime('%A')}, {d.day} {d.strftime('%B %Y')}"
            parts = [f'<!doctype html><meta charset="utf-8"><title>{title}</title>',
                     '<body style="font-family:Georgia,serif;max-width:760px;margin:40px auto;line-height:1.6">',
                     f"<h1>{title}</h1>"]
            if ds in moods:
                parts.append(f"<p>Mood: {MOODS[moods[ds]]}</p>")
            for r in rows:
                t = datetime.fromisoformat(r["created_at"]).strftime("%H:%M")
                parts += [f"<hr><h2>{t}</h2>", r["content"]]
                for p in db.execute("SELECT filename FROM photos WHERE entry_id=?", (r["id"],)):
                    src = os.path.join(PHOTO_DIR, p["filename"])
                    if os.path.exists(src):
                        z.write(src, f"DearDiarrhea/photos/{p['filename']}")
                        parts.append(f'<img src="../photos/{p["filename"]}" style="max-width:100%">')
            z.writestr(f"DearDiarrhea/{d.year}/{ds}.html", "\n".join(parts) + "\n</body>\n")
    buf.seek(0)
    return send_file(buf, mimetype="application/zip", as_attachment=True,
                     download_name=f"DearDiarrhea-export-{date.today().isoformat()}.zip")


# ---------- launch ----------

def port_in_use():
    with socket.socket() as s:
        return s.connect_ex((HOST, PORT)) == 0


if __name__ == "__main__":
    init_db()
    if "--reset-pin" in sys.argv:
        with sqlite3.connect(DB_PATH) as con:
            con.execute("DELETE FROM settings WHERE key='pin_hash'")
        print("PIN cleared. You'll set a new one next time you open Dear Diarrhea.")
        sys.exit()

    url = f"http://{HOST}:{PORT}"
    if port_in_use():
        print("Dear Diarrhea is already running. Opening it.")
        webbrowser.open(url)
        sys.exit()

    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    if "--no-browser" not in sys.argv:
        threading.Timer(1.0, webbrowser.open, args=(url,)).start()
    print(f"Dear Diarrhea running at {url}\nClose this window to stop it.")
    app.run(host=HOST, port=PORT, debug=False)
