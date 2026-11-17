from unittest.mock import Mock

import pytest
from slack_sdk import WebClient

from top5.models import Top5ApiError
from top5.slack_users import MAX_TASK_TITLE_LENGTH, clean_task_title, resolve_slack_user_email


def test_resolve_slack_user_email_success():
    client = Mock(WebClient)
    client.users_info = Mock(
        return_value={
            "ok": True,
            "user": {
                "is_bot": False,
                "profile": {"email": "Taylor@AwesomeInc.org"},
            },
        }
    )

    assert resolve_slack_user_email(client, "U123") == "taylor@awesomeinc.org"
    client.users_info.assert_called_once_with(user="U123")


def test_resolve_slack_user_email_rejects_bot():
    client = Mock(WebClient)
    client.users_info = Mock(return_value={"ok": True, "user": {"is_bot": True, "profile": {}}})

    with pytest.raises(Top5ApiError) as exc_info:
        resolve_slack_user_email(client, "UBOT")
    assert exc_info.value.code == "bot_user_not_allowed"


def test_resolve_slack_user_email_missing_email():
    client = Mock(WebClient)
    client.users_info = Mock(return_value={"ok": True, "user": {"is_bot": False, "profile": {}}})

    with pytest.raises(Top5ApiError) as exc_info:
        resolve_slack_user_email(client, "U123")
    assert exc_info.value.code == "missing_slack_email"


def test_clean_task_title_normalizes_and_truncates():
    assert clean_task_title("  Review   PR\n#42  ") == "Review PR #42"

    long_input = "a" * (MAX_TASK_TITLE_LENGTH + 20)
    cleaned = clean_task_title(long_input)
    assert len(cleaned) == MAX_TASK_TITLE_LENGTH
    assert cleaned.endswith("…")


def test_clean_task_title_rejects_blank():
    with pytest.raises(Top5ApiError) as exc_info:
        clean_task_title("   \n\t  ")
    assert exc_info.value.code == "empty_task_title"
