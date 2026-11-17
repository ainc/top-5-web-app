import json
from logging import Logger

from slack_bolt import Ack
from slack_sdk import WebClient

from top5.home_view import ACTION_MODAL_TITLE, BLOCK_MODAL_TITLE
from top5.models import Top5ApiError
from top5.service import Top5Service


def make_add_task_modal_callback(service: Top5Service):
    def add_task_modal_callback(view: dict, ack: Ack, body: dict, client: WebClient, logger: Logger) -> None:
        try:
            user_id = str(body["user"]["id"])
            values = (view.get("state") or {}).get("values") or {}
            raw_title = str(((values.get(BLOCK_MODAL_TITLE) or {}).get(ACTION_MODAL_TITLE) or {}).get("value") or "")
            metadata = _parse_metadata(view)
            entry_date = metadata.get("entry_date")
            week_monday = metadata.get("week_monday")

            try:
                result = service.add_task_for_slack_user(client, user_id, raw_title, entry_date=entry_date)
            except Top5ApiError as exc:
                ack(response_action="errors", errors={BLOCK_MODAL_TITLE: exc.message})
                return

            ack()
            status = f'Added to *{result.day_label}*, *Slot {result.slot}*: "{result.title}"'
            service.publish_home_tab(
                client,
                user_id,
                week_monday=week_monday,
                selected_date=result.entry_date,
                status_message=status,
            )
        except Exception:
            logger.exception("Error handling add task modal submission")
            ack(response_action="errors", errors={BLOCK_MODAL_TITLE: "Could not add task due to an unexpected error."})

    return add_task_modal_callback


def _parse_metadata(view: dict) -> dict[str, str]:
    raw = str(view.get("private_metadata") or "")
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return {str(k): str(v) for k, v in parsed.items() if v is not None}
    except json.JSONDecodeError:
        return {}
    return {}
