import re

from slack_sdk import WebClient

from top5.models import Top5ApiError

MAX_TASK_TITLE_LENGTH = 280
WHITESPACE_PATTERN = re.compile(r"\s+")


def resolve_slack_user_email(client: WebClient, user_id: str) -> str:
    response = client.users_info(user=user_id)
    user = response.get("user") or {}
    if user.get("is_bot"):
        raise Top5ApiError("bot_user_not_allowed", "Bots do not have a Top 5 profile.", 403)
    profile = user.get("profile") or {}
    email = str(profile.get("email") or "").strip().lower()
    if not email:
        raise Top5ApiError(
            "missing_slack_email",
            "Could not read your Slack email address. Ensure the app has the users:read.email scope and your profile has an email.",
            403,
        )
    return email


def clean_task_title(raw_text: str) -> str:
    normalized = WHITESPACE_PATTERN.sub(" ", raw_text or "").strip()
    if not normalized:
        raise Top5ApiError("empty_task_title", "Task title cannot be empty.", 400)
    if len(normalized) > MAX_TASK_TITLE_LENGTH:
        return normalized[: MAX_TASK_TITLE_LENGTH - 1].rstrip() + "…"
    return normalized
