from slack_sdk import WebClient

from top5.config import Settings
from top5.home_view import build_error_home_view, build_home_view
from top5.ingest_client import Top5IngestClient
from top5.models import AddTaskResult, Top5ApiError, WeekBoard
from top5.slack_users import clean_task_title, resolve_slack_user_email


class Top5Service:
    def __init__(self, settings: Settings, ingest_client: Top5IngestClient | None = None):
        self._settings = settings
        self._client = ingest_client or Top5IngestClient(settings)

    @property
    def settings(self) -> Settings:
        return self._settings

    def add_task_for_slack_user(
        self,
        slack_client: WebClient,
        user_id: str,
        raw_title: str,
        entry_date: str | None = None,
    ) -> AddTaskResult:
        title = clean_task_title(raw_title)
        email = resolve_slack_user_email(slack_client, user_id)
        return self._client.add_task(email=email, title=title, entry_date=entry_date)

    def get_week_for_slack_user(
        self,
        slack_client: WebClient,
        user_id: str,
        week_monday: str | None = None,
    ) -> WeekBoard:
        email = resolve_slack_user_email(slack_client, user_id)
        return self._client.get_week(email=email, week_monday=week_monday)

    def toggle_day_tasks_from_checkboxes(
        self,
        slack_client: WebClient,
        user_id: str,
        entry_date: str,
        selected_values: set[str],
        week_monday: str | None = None,
    ) -> WeekBoard:
        email = resolve_slack_user_email(slack_client, user_id)
        board = self._client.get_week(email=email, week_monday=week_monday)
        target_day = next((day for day in board.days if day.entry_date == entry_date), None)
        if not target_day:
            return board
        for task in target_day.filled_tasks:
            option_value = f"{entry_date}|{task.slot}"
            should_be_done = option_value in selected_values
            if task.done != should_be_done:
                self._client.toggle_task(email=email, entry_date=entry_date, slot=task.slot, done=should_be_done)
        return self._client.get_week(email=email, week_monday=board.week_monday)

    def publish_home_tab(
        self,
        slack_client: WebClient,
        user_id: str,
        week_monday: str | None = None,
        selected_date: str | None = None,
        status_message: str | None = None,
    ) -> None:
        try:
            week = self.get_week_for_slack_user(slack_client, user_id, week_monday=week_monday)
            view = build_home_view(
                week=week,
                timezone_name=self._settings.timezone_name,
                web_app_url=self._settings.web_app_url,
                selected_date=selected_date,
                status_message=status_message,
            )
        except Top5ApiError as exc:
            view = build_error_home_view(exc.message, self._settings.web_app_url)
        slack_client.views_publish(user_id=user_id, view=view)
