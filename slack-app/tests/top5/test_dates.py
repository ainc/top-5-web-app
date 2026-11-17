from datetime import date

from top5.dates import format_day_label, format_week_range, is_weekday, shift_week_iso, week_monday_for


def test_week_monday_for():
    assert week_monday_for(date(2026, 11, 17)) == date(2026, 11, 16)
    assert week_monday_for(date(2026, 11, 16)) == date(2026, 11, 16)
    assert week_monday_for(date(2026, 11, 20)) == date(2026, 11, 16)


def test_is_weekday():
    assert is_weekday(date(2026, 11, 16)) is True
    assert is_weekday(date(2026, 11, 20)) is True
    assert is_weekday(date(2026, 11, 21)) is False
    assert is_weekday(date(2026, 11, 22)) is False


def test_shift_week_iso():
    assert shift_week_iso("2026-11-16", -1) == "2026-11-09"
    assert shift_week_iso("2026-11-16", 1) == "2026-11-23"


def test_format_day_label():
    assert format_day_label(date(2026, 11, 17)) == "Tue (Nov 17)"


def test_format_week_range_same_and_cross_month():
    assert format_week_range("2026-11-16") == "Nov 16 – 20"
    assert format_week_range("2026-11-30") == "Nov 30 – Dec 4"
