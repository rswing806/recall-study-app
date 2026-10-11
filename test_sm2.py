import unittest
from datetime import date

from sm2 import CardState, MIN_EASE, review

TODAY = date(2026, 1, 1)


class SM2Tests(unittest.TestCase):
    def test_first_good_review_is_one_day(self):
        s, due = review(CardState(), 4, TODAY)
        self.assertEqual((s.interval, s.repetitions), (1, 1))
        self.assertEqual(due, date(2026, 1, 2))

    def test_second_good_review_is_six_days(self):
        s, _ = review(CardState(interval=1, repetitions=1), 4, TODAY)
        self.assertEqual(s.interval, 6)

    def test_interval_grows_by_ease(self):
        s, _ = review(CardState(ease=2.5, interval=6, repetitions=2), 4, TODAY)
        self.assertEqual(s.interval, 15)

    def test_failing_resets_the_card(self):
        s, due = review(CardState(ease=2.5, interval=30, repetitions=5), 1, TODAY)
        self.assertEqual((s.interval, s.repetitions), (1, 0))
        self.assertEqual(due, date(2026, 1, 2))

    def test_ease_never_drops_below_minimum(self):
        s = CardState(ease=MIN_EASE)
        for _ in range(10):
            s, _ = review(s, 0, TODAY)
        self.assertEqual(s.ease, MIN_EASE)

    def test_easy_answers_raise_ease(self):
        s, _ = review(CardState(), 5, TODAY)
        self.assertGreater(s.ease, 2.5)

    def test_rejects_bad_quality(self):
        with self.assertRaises(ValueError):
            review(CardState(), 6, TODAY)


if __name__ == "__main__":
    unittest.main()
