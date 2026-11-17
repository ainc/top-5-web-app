from unittest.mock import Mock

from slack_sdk import WebClient

from top5.config import Settings
from top5.ingest_client import Top5IngestClient
from top5.models import DayBoard, TaskSlot, Top5ApiError, WeekBoard
from top5.service import Top5Service


def test_toggle_day_tasks_only_updates_changed_slots():
    settings = Settings(ingest_url="https://example.supabase.co/functions/v1/top5-ingest", ingest_secret="sec")
    ingest = Mock(Top5IngestClient)
    service = Top5Service(settings, ingest_client=ingest)
    slack_client = Mock(WebClient)
    slack_client.users_info = Mock(
        return_value={"ok": True, "user": {"is_bot": False, "profile": {"email": "taylor@awesomeinc.org"}}}
    )
    board = WeekBoard(
        profile_id="p1",
        profile_name="Taylor",
        season_name="Q4 2026",
        week_monday="2026-11-16",
        week_label="Nov 16 – 20",
        days=(
            DayBoard(
                "2026-11-17",
                "Tue",
                "Nov 17",
                (TaskSlot(1, "Task A", False), TaskSlot(2, "Task B", True)),
                0,
            ),
        ),
    )
    ingest.get_week.return_value = board

    service.toggle_day_tasks_from_checkboxes(
        slack_client,
        user_id="U123",
        entry_date="2026-11-17",
        selected_values={"2026-11-17|1"},
        week_monday="2026-11-16",
    )

    assert ingest.toggle_task.call_count == 2
    ingest.toggle_task.assert_any_call(email="taylor@awesomeinc.org", entry_date="2026-11-17", slot=1, done=True)
    ingest.toggle_task.assert_any_call(email="taylor@awesomeinc.org", entry_date="2026-11-17", slot=2, done=False)


def test_publish_home_tab_shows_error_view_on_api_failure():
    settings = Settings(ingest_url="https://example.supabase.co/functions/v1/top5-ingest", ingest_secret="sec")
    ingest = Mock(Top5IngestClient)
    service = Top5Service(settings, ingest_client=ingest)
    slack_client = Mock(WebClient)
    slack_client.users_info = Mock(
        return_value={"ok": True, "user": {"is_bot": False, "profile": {"email": "taylor@awesomeinc.org"}}}
    )
    ingest.get_week.side_effect = Top5ApiError("profile_not_found", "No profile linked", 404)

    service.publish_home_tab(slack_client, "U123")

    slack_client.views_publish.assert_called_once()
    view = slack_client.views_publish.call_args.kwargs["view"]
    assert view["type"] == "home"
    assert "No profile linked" in view["blocks"][1]["text"]["text"]
