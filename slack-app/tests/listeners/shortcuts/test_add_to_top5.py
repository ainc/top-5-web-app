import logging
from unittest.mock import Mock

from slack_sdk import WebClient

from listeners.shortcuts.add_to_top5 import make_add_to_top5_shortcut_callback
from top5.models import AddTaskResult, Top5ApiError
from top5.service import Top5Service

test_logger = logging.getLogger(__name__)


class TestAddToTop5Shortcut:
    def setup_method(self):
        self.ack = Mock()
        self.respond = Mock()
        self.client = Mock(WebClient)
        self.service = Mock(Top5Service)
        self.callback = make_add_to_top5_shortcut_callback(self.service)

    def test_message_shortcut_adds_task_via_response_url(self):
        self.service.add_task_for_slack_user.return_value = AddTaskResult(
            entry_date="2026-11-17",
            day_label="Tue (Nov 17)",
            slot=1,
            title="Send onboarding notes",
            profile_name="Taylor",
        )
        body = {
            "user": {"id": "U123"},
            "message": {"text": "Send onboarding notes"},
            "response_url": "https://hooks.slack.com/actions/T1/B1/X1",
        }

        self.callback(body=body, ack=self.ack, client=self.client, logger=test_logger, respond=self.respond)

        self.ack.assert_called_once()
        self.service.add_task_for_slack_user.assert_called_once_with(self.client, "U123", "Send onboarding notes")
        self.respond.assert_called_once_with(
            response_type="ephemeral",
            text='Added to *Tue (Nov 17)*, *Slot 1*: "Send onboarding notes"',
        )

    def test_message_shortcut_falls_back_to_post_ephemeral_on_error(self):
        self.service.add_task_for_slack_user.side_effect = Top5ApiError(
            "profile_not_found", "No Top 5 profile is linked to taylor@awesomeinc.org.", 404
        )
        body = {
            "user": {"id": "U123"},
            "channel": {"id": "C123"},
            "message": {"text": "Follow up with team"},
        }

        self.callback(body=body, ack=self.ack, client=self.client, logger=test_logger, respond=None)

        self.ack.assert_called_once()
        self.client.chat_postEphemeral.assert_called_once_with(
            channel="C123",
            user="U123",
            text="Could not add task: No Top 5 profile is linked to taylor@awesomeinc.org.",
        )
