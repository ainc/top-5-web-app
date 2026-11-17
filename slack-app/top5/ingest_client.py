import json
from typing import Any
from urllib import error, request

from top5.config import Settings
from top5.models import AddTaskResult, DayBoard, TaskSlot, ToggleTaskResult, Top5ApiError, WeekBoard


class Top5IngestClient:
    def __init__(self, settings: Settings):
        self._settings = settings

    def add_task(self, email: str, title: str, entry_date: str | None = None) -> AddTaskResult:
        payload: dict[str, Any] = {
            "action": "add_task",
            "email": email,
            "title": title,
            "timezone": self._settings.timezone_name,
        }
        if entry_date:
            payload["entry_date"] = entry_date
        data = self._post(payload)
        return AddTaskResult(
            entry_date=str(data["entry_date"]),
            day_label=str(data["day_label"]),
            slot=int(data["slot"]),
            title=str(data["title"]),
            profile_name=str(data.get("profile_name") or ""),
        )

    def get_week(self, email: str, week_monday: str | None = None) -> WeekBoard:
        payload: dict[str, Any] = {
            "action": "get_week",
            "email": email,
            "timezone": self._settings.timezone_name,
        }
        if week_monday:
            payload["week_monday"] = week_monday
        data = self._post(payload)
        days = tuple(
            DayBoard(
                entry_date=str(day["entry_date"]),
                day_name=str(day["day_name"]),
                date_label=str(day["date_label"]),
                points=int(day.get("points") or 0),
                tasks=tuple(
                    TaskSlot(
                        slot=int(task["slot"]),
                        title=str(task.get("title") or ""),
                        done=bool(task.get("done")),
                    )
                    for task in day.get("tasks", [])
                ),
            )
            for day in data.get("days", [])
        )
        return WeekBoard(
            profile_id=str(data["profile_id"]),
            profile_name=str(data.get("profile_name") or ""),
            season_name=str(data.get("season_name") or ""),
            week_monday=str(data["week_monday"]),
            week_label=str(data["week_label"]),
            days=days,
            weekly_points=int(data.get("weekly_points") or 0),
            weekly_max_points=int(data.get("weekly_max_points") or 125),
        )

    def toggle_task(self, email: str, entry_date: str, slot: int, done: bool) -> ToggleTaskResult:
        data = self._post(
            {
                "action": "toggle_task",
                "email": email,
                "entry_date": entry_date,
                "slot": slot,
                "done": done,
            }
        )
        return ToggleTaskResult(
            entry_date=str(data["entry_date"]),
            slot=int(data["slot"]),
            done=bool(data["done"]),
        )

    def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self._settings.ingest_url:
            raise Top5ApiError("missing_ingest_url", "TOP5_INGEST_URL is not configured.", 500)
        if not self._settings.ingest_secret:
            raise Top5ApiError("missing_ingest_secret", "TOP5_INGEST_SECRET is not configured.", 500)
        body = json.dumps(payload).encode("utf-8")
        req = request.Request(
            self._settings.ingest_url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-Top5-Ingest-Secret": self._settings.ingest_secret,
            },
        )
        try:
            with request.urlopen(req, timeout=self._settings.request_timeout_seconds) as resp:
                raw = resp.read().decode("utf-8")
                parsed = json.loads(raw)
        except error.HTTPError as exc:
            raw_err = exc.read().decode("utf-8", errors="replace")
            try:
                parsed_err = json.loads(raw_err)
            except json.JSONDecodeError:
                raise Top5ApiError("ingest_http_error", f"Top 5 backend returned HTTP {exc.code}.", exc.code) from exc
            raise Top5ApiError(
                str(parsed_err.get("error") or "ingest_error"),
                str(parsed_err.get("message") or f"Top 5 backend returned HTTP {exc.code}."),
                exc.code,
            ) from exc
        except (error.URLError, TimeoutError) as exc:
            raise Top5ApiError("ingest_unreachable", "Could not reach the Top 5 backend in time.", 504) from exc

        if not parsed.get("ok"):
            raise Top5ApiError(
                str(parsed.get("error") or "ingest_error"),
                str(parsed.get("message") or "Top 5 request failed."),
                400,
            )
        return parsed
