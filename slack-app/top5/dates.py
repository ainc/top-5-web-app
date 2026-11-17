from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

WEEKDAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def current_local_date(timezone_name: str) -> date:
    return datetime.now(ZoneInfo(timezone_name)).date()


def is_weekday(target_date: date) -> bool:
    return target_date.weekday() < 5


def week_monday_for(target_date: date) -> date:
    return target_date - timedelta(days=target_date.weekday())


def shift_week_iso(week_monday_iso: str, delta_weeks: int) -> str:
    base_date = date.fromisoformat(week_monday_iso)
    return (base_date + timedelta(days=delta_weeks * 7)).isoformat()


def format_day_label(target_date: date) -> str:
    day_name = WEEKDAY_NAMES[target_date.weekday()]
    month_name = target_date.strftime("%b")
    return f"{day_name} ({month_name} {target_date.day})"


def format_week_range(week_monday_iso: str) -> str:
    monday = date.fromisoformat(week_monday_iso)
    friday = monday + timedelta(days=4)
    if monday.month == friday.month:
        return f"{monday.strftime('%b')} {monday.day} – {friday.day}"
    return f"{monday.strftime('%b')} {monday.day} – {friday.strftime('%b')} {friday.day}"
