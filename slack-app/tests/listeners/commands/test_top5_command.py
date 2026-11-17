import logging
from unittest.mock import Mock

from slack_sdk import WebClient

from listeners.commands.top5_command import make_top5_command_callback
from top5.models import AddTaskResult, Top5ApiError
from top5.service import Top5Service

test_logger = logging.getLogger(__name__)


class TestTop5Command:
    def setup_method(self):
        self.ack = Mock()
        self.respond = Mock()
        self.client = Mock(WebClient)
        self.service = Mock(Top5Service)
        self.callback = make_top5_command_callback(self.service)

    def test_adds_task_and_replies_with_day_and_slot(self):
        self.service.add_task_for_slack_user.return_value = AddTaskResult(
            entry_date="2026-11-17",
            day_label="Tue (Nov 17)",
            slot=3,
            title="Finish quarterly review",
            profile_name="Taylor",
        )

        self.callback(
            {"user_id": "U123", "text": "Finish quarterly review"},
            ack=self.ack,
            respond=self.respond,
            client=self.client,
            logger=test_logger,
        )

        self.ack.assert_called_once()
        self.service.add_task_for_slack_user.assert_called_once_with(self.client, "U123", "Finish quarterly review")
        self.respond.assert_called_once_with(
            response_type="ephemeral",
            text='Added to *Tue (Nov 17)*, *Slot 3*: "Finish quarterly review"',
        )
        self.service.publish_home_tab.assert_called_once_with(self.client, "U123", selected_date="2026-11-17")

    def test_empty_text_returns_usage(self):
        self.callback(
            {"user_id": "U123", "text": "   "},
            ack=self.ack,
            respond=self.respond,
            client=self.client,
            logger=test_logger,
        )

        self.ack.assert_called_once()
        self.service.add_task_for_slack_user.assert_not_called()
        assert "Usage:" in self.respond.call_args.kwargs["text"]

    def test_refusal_replies_with_reason(self):
        self.service.add_task_for_slack_user.side_effect = Top5ApiError(
            "day_full", "All 5 slots for Tue (Nov 17) are already filled.", 409
        )

        self.callback(
            {"user_id": "U123", "text": "Extra task"},
            ack=self.ack,
            respond=self.respond,
            client=self.client,
            logger=test_logger,
        )

        self.ack.assert_called_once()
        self.respond.assert_called_once_with(
            response_type="ephemeral",
            text="Could not add task: All 5 slots for Tue (Nov 17) are already filled.",
        )
