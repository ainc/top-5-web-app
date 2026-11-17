from logging import Logger

from slack_bolt import Ack, Respond
from slack_sdk import WebClient

from top5.models import Top5ApiError
from top5.service import Top5Service

SHORTCUT_ADD_TO_TOP5 = "add_to_top5_message"


def make_add_to_top5_shortcut_callback(service: Top5Service):
    def add_to_top5_shortcut_callback(
        body: dict,
        ack: Ack,
        client: WebClient,
        logger: Logger,
        respond: Respond | None = None,
    ) -> None:
        try:
            ack()
            user_id = str((body.get("user") or {}).get("id") or "")
            raw_text = str((body.get("message") or {}).get("text") or "")
            result = service.add_task_for_slack_user(client, user_id, raw_text)
            _reply_ephemeral(
                body=body,
                client=client,
                respond=respond,
                user_id=user_id,
                text=f'Added to *{result.day_label}*, *Slot {result.slot}*: "{result.title}"',
                logger=logger,
            )
            _best_effort_refresh_home(service, client, user_id, result.entry_date, logger)
        except Top5ApiError as exc:
            user_id = str((body.get("user") or {}).get("id") or "")
            _reply_ephemeral(
                body=body,
                client=client,
                respond=respond,
                user_id=user_id,
                text=f"Could not add task: {exc.message}",
                logger=logger,
            )
        except Exception:
            logger.exception("Error handling Add to my Top 5 shortcut")
            user_id = str((body.get("user") or {}).get("id") or "")
            _reply_ephemeral(
                body=body,
                client=client,
                respond=respond,
                user_id=user_id,
                text="Could not add task due to an unexpected error.",
                logger=logger,
            )

    return add_to_top5_shortcut_callback


def _reply_ephemeral(
    body: dict,
    client: WebClient,
    respond: Respond | None,
    user_id: str,
    text: str,
    logger: Logger,
) -> None:
    if respond is not None and body.get("response_url"):
        respond(response_type="ephemeral", text=text)
        return
    channel_id = str((body.get("channel") or {}).get("id") or "")
    if channel_id and user_id:
        try:
            client.chat_postEphemeral(channel=channel_id, user=user_id, text=text)
            return
        except Exception:
            logger.debug("chat_postEphemeral failed; falling back to DM", exc_info=True)
    if user_id:
        client.chat_postMessage(channel=user_id, text=text)


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
