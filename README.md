[README (2).md](https://github.com/user-attachments/files/33306736/README.2.md)
# Recall

A study app that uses flashcards and spaced repetition to help you remember more with less time. Cards you know well come back later, and cards you forget come back soon.

![Study session](screenshots/study.png)

<!-- Live demo: add your link here once the site is deployed -->

## Features

- Create decks and cards, and study only the cards that are due today
- Spaced-repetition scheduling based on the SM-2 algorithm, written from scratch in `sm2.py`
- Keyboard shortcuts: Space shows the answer, 1 to 4 rates how well you knew it
- Cards you miss come back at the end of the same session
- Import and export decks as CSV files
- Focus timer (focus and break sessions) that saves your finished sessions
- Progress page with a day streak, cards reviewed per day, and focus minutes per day

## Built with

Python (Flask), SQLite, HTML, CSS, JavaScript, Chart.js

## Run it on your computer

You need Python 3.9 or newer.

**Windows (PowerShell)**

```
git clone https://github.com/rswing806/recall-study-app.git
cd recall-study-app
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

**Mac or Linux**

```
git clone https://github.com/rswing806/recall-study-app.git
cd recall-study-app
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Then open http://127.0.0.1:5001 in your browser.

## Using it

1. On the **Decks** tab, create a deck and add some cards (a question on the front, the answer on the back).
2. On the **Study** tab, choose the deck and start a session.
3. Press Space to show the answer, then rate it: Again (1), Hard (2), Good (3), or Easy (4).
4. Come back tomorrow. The app only shows cards that are due.

To import cards, use a CSV file with two columns named `front` and `back`.

## Tests

```
python -m unittest test_sm2
```

These check the scheduling algorithm: intervals grow after good answers, a failed card starts over, and the ease factor never drops below its minimum.

## How it works

- `sm2.py` contains the scheduling function. Each review gets a quality score from 0 to 5. The buttons send 1, 3, 4, and 5.
- After a successful review, the first interval is 1 day, the second is 6 days, and each one after that is multiplied by the card's ease factor. A failed review resets the card to 1 day. Easy answers raise the ease factor and hard answers lower it.
- `app.py` is a small JSON API (decks, cards, reviews, stats, import and export) on top of SQLite. The database file is created automatically.
- The page in `static/` is a single page built with plain JavaScript. All text from cards is inserted as text, never as HTML, so it can't inject code.
- The focus timer counts from the clock time instead of counting ticks, so it stays accurate when the tab is in the background.

## Known limitations

- It is a single-user app with no accounts, so everyone using the same copy shares the same decks.
- There is no card editing yet, only adding and deleting.
- Cards have text only, with no images.

## What I learned

<!-- Write this part yourself, in your own words. Name one or two real problems you ran into
     and how you solved them. Admissions readers care about this section most. -->

## Ideas for next steps

- Edit cards and move them between decks
- User accounts so several people can use one site
- Images on cards
- Show the next review date for each card

## Credits and license

The SM-2 algorithm was originally developed by Piotr Wozniak for SuperMemo. This project is my own implementation of it.

MIT
