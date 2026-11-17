import json

from top5.home_view import (
    ACTION_QUICK_ADD_INPUT,
    ADD_TASK_MODAL_CALLBACK_ID,
    build_add_task_modal,
    build_error_home_view,
    build_home_view,
)
from top5.models import DayBoard, TaskSlot, WeekBoard


def _sample_week() -> WeekBoard:
    long_title = "Finish the comprehensive quarterly planning document for the entire engineering organization"
    return WeekBoard(
        profile_id="p1",
        profile_name="Taylor",
        season_name="Q4 2026",
        week_monday="2026-11-16",
        week_label="Nov 16 – 20",
        weekly_points=25,
        weekly_max_points=125,
        days=(
            DayBoard("2026-11-16", "Mon", "Nov 16", (TaskSlot(1, long_title, True),), 25),
            DayBoard("2026-11-17", "Tue", "Nov 17", (), 0),
            DayBoard("2026-11-18", "Wed", "Nov 18", (), 0),
            DayBoard("2026-11-19", "Thu", "Nov 19", (), 0),
            DayBoard("2026-11-20", "Fri", "Nov 20", (), 0),
        ),
    )


def test_build_home_view_includes_quick_add_and_truncated_checkboxes():
    view = build_home_view(
        week=_sample_week(),
        timezone_name="America/New_York",
        web_app_url="https://top-5-web-app.netlify.app/",
        selected_date="2026-11-17",
        status_message="*Added* task",
    )

    assert view["type"] == "home"
    metadata = json.loads(view["private_metadata"])
    assert metadata == {"week_monday": "2026-11-16", "selected_date": "2026-11-17"}

    containers = [block for block in view["blocks"] if block["type"] == "container"]
    assert len(containers) == 6
    quick_add = containers[0]
    assert quick_add["child_blocks"][1]["element"]["action_id"] == ACTION_QUICK_ADD_INPUT

    mon_tile = containers[1]
    checkbox_el = mon_tile["child_blocks"][0]["elements"][0]
    assert len(checkbox_el["options"][0]["text"]["text"]) <= 75
    assert len(checkbox_el["initial_options"]) == 1


def test_build_error_home_view_and_modal():
    err_view = build_error_home_view("No profile linked", "https://top-5-web-app.netlify.app/")
    assert err_view["type"] == "home"
    assert "No profile linked" in err_view["blocks"][1]["text"]["text"]

    modal = build_add_task_modal("2026-11-17", "Tue (Nov 17)", "2026-11-16")
    assert modal["type"] == "modal"
    assert modal["callback_id"] == ADD_TASK_MODAL_CALLBACK_ID
    assert json.loads(modal["private_metadata"]) == {
        "entry_date": "2026-11-17",
        "week_monday": "2026-11-16",
    }
