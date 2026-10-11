"""Spaced-repetition scheduling based on the SM-2 algorithm.

Each time you review a card you rate how well you remembered it (0-5).
Good answers push the next review further away; bad answers bring the card back soon.
"""
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional

MIN_EASE = 1.3


@dataclass
class CardState:
    ease: float = 2.5      # how quickly the interval grows
    interval: int = 0      # days until the next review
    repetitions: int = 0   # consecutive successful reviews


def review(state: CardState, quality: int, today: Optional[date] = None):
    """Return (new_state, due_date) after reviewing a card with the given quality (0-5)."""
    if not 0 <= quality <= 5:
        raise ValueError("quality must be between 0 and 5")
    today = today or date.today()

    if quality < 3:                       # forgot it: start the card over
        repetitions, interval = 0, 1
    else:
        if state.repetitions == 0:
            interval = 1
        elif state.repetitions == 1:
            interval = 6
        else:
            interval = round(state.interval * state.ease)
        repetitions = state.repetitions + 1

    # The ease factor drifts down for hard cards and up for easy ones.
    ease = state.ease + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)
    ease = max(MIN_EASE, ease)

    return CardState(round(ease, 3), interval, repetitions), today + timedelta(days=interval)
