import json
from logging import Logger

from slack_bolt import Ack
from slack_sdk import WebClient

from top5.home_view import (
    ACTION_DAY_SELECT,
    ACTION_TASK_CHECKBOX_PREFIX,
    BLOCK_DAY_SELECT,
    build_add_task_modal,
)
from top5.models import Top5ApiError
from top5.service import Top5Service


def make_week_navigation_callback(service: Top5Service):
    def week_navigation_callback(ack: Ack, body: dict, client: WebClient, action: dict, logger: Logger) -> None:
        try:
            ack()
            user_id = str(body["user"]["id"])
            target_week = str(action.get("value") or "") or None
            metadata = _parse_metadata(body)
            service.publish_home_tab(
                client,
                user_id,
                week_monday=target_week,
                selected_date=metadata.get("selected_date"),
            )
        except Exception:
            logger.exception("Error navigating Top 5 week")

    return week_navigation_callback


def make_retry_home_callback(service: Top5Service):
    def retry_home_callback(ack: Ack, body: dict, client: WebClient, logger: Logger) -> None:
        try:
            ack()
            service.publish_home_tab(client, str(body["user"]["id"]))
        except Exception:
            logger.exception("Error retrying Top 5 home tab")

    return retry_home_callback


def make_day_select_callback():
    def day_select_callback(ack: Ack) -> None:
        ack()

    return day_select_callback


def make_quick_add_callback(service: Top5Service):
    def quick_add_callback(ack: Ack, body: dict, client: WebClient, action: dict, logger: Logger) -> None:
        try:
            ack()
            user_id = str(body["user"]["id"])
            metadata = _parse_metadata(body)
            week_monday = metadata.get("week_monday")
            selected_date = _read_selected_date(body) or metadata.get("selected_date")
            raw_title = str(action.get("value") or "")
            try:
                result = service.add_task_for_slack_user(client, user_id, raw_title, entry_date=selected_date)
                status = f'Added to *{result.day_label}*, *Slot {result.slot}*: "{result.title}"'
                selected_date = result.entry_date
            except Top5ApiError as exc:
                status = f"*Could not add task:* {exc.message}"
            service.publish_home_tab(
                client,
                user_id,
                week_monday=week_monday,
                selected_date=selected_date,
                status_message=status,
            )
        except Exception:
            logger.exception("Error handling quick add on Home tab")

    return quick_add_callback


def make_open_add_modal_callback():
    def open_add_modal_callback(ack: Ack, body: dict, client: WebClient, action: dict, logger: Logger) -> None:
        try:
            ack()
            payload = json.loads(str(action.get("value") or "{}"))
            modal = build_add_task_modal(
                entry_date=str(payload["entry_date"]),
                day_label=str(payload["day_label"]),
                week_monday=str(payload["week_monday"]),
            )
            client.views_open(trigger_id=body["trigger_id"], view=modal)
        except Exception:
            logger.exception("Error opening Top 5 add task modal")

    return open_add_modal_callback


def make_toggle_checkboxes_callback(service: Top5Service):
    def toggle_checkboxes_callback(ack: Ack, body: dict, client: WebClient, action: dict, logger: Logger) -> None:
        try:
            ack()
            user_id = str(body["user"]["id"])
            action_id = str(action.get("action_id") or "")
            entry_date = action_id.removeprefix(ACTION_TASK_CHECKBOX_PREFIX)
            selected_values = {str(opt.get("value") or "") for opt in action.get("selected_options", [])}
            metadata = _parse_metadata(body)
            week_monday = metadata.get("week_monday")
            try:
                service.toggle_day_tasks_from_checkboxes(
                    client,
                    user_id=user_id,
                    entry_date=entry_date,
                    selected_values=selected_values,
                    week_monday=week_monday,
                )
                status = None
            except Top5ApiError as exc:
                status = f"*Could not update task:* {exc.message}"
            service.publish_home_tab(
                client,
                user_id,
                week_monday=week_monday,
                selected_date=metadata.get("selected_date"),
                status_message=status,
            )
        except Exception:
            logger.exception("Error toggling Top 5 task checkbox")

    return toggle_checkboxes_callback


def _parse_metadata(body: dict) -> dict[str, str]:
    raw = str((body.get("view") or {}).get("private_metadata") or "")
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return {str(k): str(v) for k, v in parsed.items() if v is not None}
    except json.JSONDecodeError:
        return {}
    return {}


def _read_selected_date(body: dict) -> str | None:
    values = ((body.get("view") or {}).get("state") or {}).get("values") or {}
    day_block = values.get(BLOCK_DAY_SELECT) or {}
    day_action = day_block.get(ACTION_DAY_SELECT) or {}
    selected = day_action.get("selected_option") or {}
    value = str(selected.get("value") or "").strip()
    return value or None
