from logging import Logger

from slack_bolt import Ack, Respond
from slack_sdk import WebClient

from top5.models import Top5ApiError
from top5.service import Top5Service


def make_top5_command_callback(service: Top5Service):
    def top5_command_callback(command: dict, ack: Ack, respond: Respond, client: WebClient, logger: Logger) -> None:
        try:
            ack()
            raw_text = str(command.get("text") or "").strip()
            if not raw_text:
                respond(
                    response_type="ephemeral",
                    text="Usage: `/top5 <task title>` — enter a task to add to your next open slot today.",
                )
                return

            user_id = str(command["user_id"])
            result = service.add_task_for_slack_user(client, user_id, raw_text)
            respond(
                response_type="ephemeral",
                text=f'Added to *{result.day_label}*, *Slot {result.slot}*: "{result.title}"',
            )
            _best_effort_refresh_home(service, client, user_id, result.entry_date, logger)
        except Top5ApiError as exc:
            respond(response_type="ephemeral", text=f"Could not add task: {exc.message}")
        except Exception:
            logger.exception("Error handling /top5 command")
            respond(response_type="ephemeral", text="Could not add task due to an unexpected error.")

    return top5_command_callback


def _best_effort_refresh_home(
    service: Top5Service,
    client: WebClient,
    user_id: str,
    entry_date: str,
    logger: Logger,
) -> None:
    try:
        service.publish_home_tab(client, user_id, selected_date=entry_date)
    except Exception:
        logger.debug("Best-effort Home tab refresh skipped", exc_info=True)
