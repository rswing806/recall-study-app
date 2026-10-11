"""Recall - a study companion with spaced-repetition flashcards, a focus timer, and stats.

Run:  python app.py      then open http://127.0.0.1:5001
"""
import csv
import io
import os
import sqlite3
from datetime import date, timedelta

from flask import Flask, Response, g, jsonify, request, send_from_directory

import sm2

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE = os.environ.get("DATABASE", os.path.join(BASE_DIR, "recall.db"))

app = Flask(__name__, static_folder="static", static_url_path="/static")

SCHEMA = """
CREATE TABLE IF NOT EXISTS decks (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY,
    deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    front TEXT NOT NULL, back TEXT NOT NULL,
    ease REAL NOT NULL DEFAULT 2.5,
    interval INTEGER NOT NULL DEFAULT 0,
    reps INTEGER NOT NULL DEFAULT 0,
    due TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY,
    card_id INTEGER, quality INTEGER NOT NULL, reviewed_on TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS focus_sessions (
    id INTEGER PRIMARY KEY, minutes INTEGER NOT NULL, done_on TEXT NOT NULL
);
"""


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DATABASE)
    db.executescript(SCHEMA)
    db.commit()
    db.close()


def bad(message, code=400):
    return jsonify(error=message), code


def clean(value, limit):
    value = value.strip() if isinstance(value, str) else ""
    return value if 0 < len(value) <= limit else None


def add_card(db, deck_id, front, back):
    db.execute("INSERT INTO cards (deck_id, front, back, due) VALUES (?,?,?,?)",
               (deck_id, front, back, date.today().isoformat()))


# ---------- pages ----------
@app.route("/")
def home():
    return send_from_directory(app.static_folder, "index.html")


# ---------- decks ----------
@app.get("/api/decks")
def list_decks():
    rows = get_db().execute(
        """SELECT d.id, d.name, COUNT(c.id) AS cards,
                  COALESCE(SUM(c.due <= ?), 0) AS due
           FROM decks d LEFT JOIN cards c ON c.deck_id = d.id
           GROUP BY d.id ORDER BY d.name""", (date.today().isoformat(),)).fetchall()
    return jsonify([dict(r) for r in rows])


@app.post("/api/decks")
def create_deck():
    name = clean((request.get_json(silent=True) or {}).get("name"), 100)
    if not name:
        return bad("Give the deck a name (up to 100 characters).")
    db = get_db()
    cur = db.execute("INSERT INTO decks (name) VALUES (?)", (name,))
    db.commit()
    return jsonify(id=cur.lastrowid, name=name), 201


@app.delete("/api/decks/<int:deck_id>")
def delete_deck(deck_id):
    db = get_db()
    db.execute("DELETE FROM decks WHERE id = ?", (deck_id,))
    db.commit()
    return "", 204


# ---------- cards ----------
@app.get("/api/decks/<int:deck_id>/cards")
def list_cards(deck_id):
    rows = get_db().execute(
        "SELECT id, front, back, due, interval FROM cards WHERE deck_id = ? ORDER BY id DESC", (deck_id,)).fetchall()
    return jsonify([dict(r) for r in rows])


@app.post("/api/decks/<int:deck_id>/cards")
def create_card(deck_id):
    data = request.get_json(silent=True) or {}
    front, back = clean(data.get("front"), 2000), clean(data.get("back"), 2000)
    if not front or not back:
        return bad("Fill in both sides of the card.")
    db = get_db()
    if db.execute("SELECT 1 FROM decks WHERE id = ?", (deck_id,)).fetchone() is None:
        return bad("Deck not found.", 404)
    add_card(db, deck_id, front, back)
    db.commit()
    return "", 201


@app.delete("/api/cards/<int:card_id>")
def delete_card(card_id):
    db = get_db()
    db.execute("DELETE FROM cards WHERE id = ?", (card_id,))
    db.commit()
    return "", 204


@app.get("/api/decks/<int:deck_id>/due")
def due_cards(deck_id):
    rows = get_db().execute(
        "SELECT id, front, back FROM cards WHERE deck_id = ? AND due <= ? ORDER BY due, id LIMIT 50",
        (deck_id, date.today().isoformat())).fetchall()
    return jsonify([dict(r) for r in rows])


@app.post("/api/cards/<int:card_id>/review")
def review_card(card_id):
    quality = (request.get_json(silent=True) or {}).get("quality")
    if not isinstance(quality, int) or isinstance(quality, bool) or not 0 <= quality <= 5:
        return bad("quality must be a whole number from 0 to 5.")
    db = get_db()
    card = db.execute("SELECT * FROM cards WHERE id = ?", (card_id,)).fetchone()
    if card is None:
        return bad("Card not found.", 404)
    state, due = sm2.review(sm2.CardState(card["ease"], card["interval"], card["reps"]), quality)
    db.execute("UPDATE cards SET ease=?, interval=?, reps=?, due=? WHERE id=?",
               (state.ease, state.interval, state.repetitions, due.isoformat(), card_id))
    db.execute("INSERT INTO reviews (card_id, quality, reviewed_on) VALUES (?,?,?)",
               (card_id, quality, date.today().isoformat()))
    db.commit()
    return jsonify(interval=state.interval, due=due.isoformat())


# ---------- CSV import / export ----------
@app.get("/api/decks/<int:deck_id>/export.csv")
def export_deck(deck_id):
    db = get_db()
    deck = db.execute("SELECT name FROM decks WHERE id = ?", (deck_id,)).fetchone()
    if deck is None:
        return bad("Deck not found.", 404)
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["front", "back"])
    for row in db.execute("SELECT front, back FROM cards WHERE deck_id = ? ORDER BY id", (deck_id,)):
        writer.writerow([row["front"], row["back"]])
    filename = "".join(ch if ch.isalnum() else "_" for ch in deck["name"]) or "deck"
    return Response(out.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f"attachment; filename={filename}.csv"})


@app.post("/api/decks/<int:deck_id>/import")
def import_deck(deck_id):
    text = (request.get_json(silent=True) or {}).get("csv", "")
    if not isinstance(text, str) or not text.strip():
        return bad("The file is empty.")
    db = get_db()
    if db.execute("SELECT 1 FROM decks WHERE id = ?", (deck_id,)).fetchone() is None:
        return bad("Deck not found.", 404)
    added = 0
    for i, row in enumerate(csv.reader(io.StringIO(text))):
        if len(row) < 2:
            continue
        front, back = row[0].strip(), row[1].strip()
        if i == 0 and front.lower() == "front" and back.lower() == "back":
            continue
        if front and back and len(front) <= 2000 and len(back) <= 2000:
            add_card(db, deck_id, front, back)
            added += 1
    db.commit()
    return jsonify(added=added)


# ---------- focus timer + stats ----------
@app.post("/api/focus")
def log_focus():
    minutes = (request.get_json(silent=True) or {}).get("minutes")
    if not isinstance(minutes, int) or isinstance(minutes, bool) or not 1 <= minutes <= 180:
        return bad("minutes must be a whole number from 1 to 180.")
    db = get_db()
    db.execute("INSERT INTO focus_sessions (minutes, done_on) VALUES (?, ?)", (minutes, date.today().isoformat()))
    db.commit()
    return "", 201


@app.get("/api/stats")
def stats():
    db, today = get_db(), date.today()
    days = [(today - timedelta(days=n)).isoformat() for n in range(13, -1, -1)]
    reviews = dict(db.execute("SELECT reviewed_on, COUNT(*) FROM reviews WHERE reviewed_on >= ? GROUP BY reviewed_on",
                              (days[0],)).fetchall())
    focus = dict(db.execute("SELECT done_on, SUM(minutes) FROM focus_sessions WHERE done_on >= ? GROUP BY done_on",
                            (days[0],)).fetchall())

    # Streak: consecutive days with at least one review (today may still be empty).
    studied = {r[0] for r in db.execute("SELECT DISTINCT reviewed_on FROM reviews")}
    streak, day = 0, today if today.isoformat() in studied else today - timedelta(days=1)
    while day.isoformat() in studied:
        streak += 1
        day -= timedelta(days=1)

    one = lambda sql: db.execute(sql).fetchone()[0]
    return jsonify(
        days=days,
        reviews=[reviews.get(d, 0) for d in days],
        focus=[focus.get(d, 0) for d in days],
        streak=streak,
        total_cards=one("SELECT COUNT(*) FROM cards"),
        mature_cards=one("SELECT COUNT(*) FROM cards WHERE interval >= 21"),
        total_reviews=one("SELECT COUNT(*) FROM reviews"),
    )


init_db()

if __name__ == "__main__":
    app.run(port=5001, debug=True)
