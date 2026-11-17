import json
import logging
from unittest.mock import Mock

from slack_sdk import WebClient

from listeners.views.add_task_modal import make_add_task_modal_callback
from top5.home_view import ACTION_MODAL_TITLE, BLOCK_MODAL_TITLE
from top5.models import AddTaskResult, Top5ApiError
from top5.service import Top5Service

test_logger = logging.getLogger(__name__)


class TestAddTaskModal:
    def setup_method(self):
        self.ack = Mock()
        self.client = Mock(WebClient)
        self.service = Mock(Top5Service)
        self.callback = make_add_task_modal_callback(self.service)

    def test_modal_submission_adds_task_and_refreshes_home(self):
        self.service.add_task_for_slack_user.return_value = AddTaskResult(
            entry_date="2026-11-17",
            day_label="Tue (Nov 17)",
            slot=4,
            title="Update scorecard",
            profile_name="Taylor",
        )
        view = {
            "private_metadata": json.dumps({"entry_date": "2026-11-17", "week_monday": "2026-11-16"}),
            "state": {
                "values": {
                    BLOCK_MODAL_TITLE: {ACTION_MODAL_TITLE: {"value": "Update scorecard"}},
                }
            },
        }

        self.callback(view=view, ack=self.ack, body={"user": {"id": "U123"}}, client=self.client, logger=test_logger)

        self.ack.assert_called_once_with()
        self.service.add_task_for_slack_user.assert_called_once_with(
            self.client, "U123", "Update scorecard", entry_date="2026-11-17"
        )
        self.service.publish_home_tab.assert_called_once_with(
            self.client,
            "U123",
            week_monday="2026-11-16",
            selected_date="2026-11-17",
            status_message='Added to *Tue (Nov 17)*, *Slot 4*: "Update scorecard"',
        )

    def test_modal_submission_returns_field_error_on_refusal(self):
        self.service.add_task_for_slack_user.side_effect = Top5ApiError(
            "day_full", "All 5 slots for Tue (Nov 17) are already filled.", 409
        )
        view = {
            "private_metadata": json.dumps({"entry_date": "2026-11-17", "week_monday": "2026-11-16"}),
            "state": {
                "values": {
                    BLOCK_MODAL_TITLE: {ACTION_MODAL_TITLE: {"value": "Overflow task"}},
                }
            },
        }

        self.callback(view=view, ack=self.ack, body={"user": {"id": "U123"}}, client=self.client, logger=test_logger)

        self.ack.assert_called_once_with(
            response_action="errors",
            errors={BLOCK_MODAL_TITLE: "All 5 slots for Tue (Nov 17) are already filled."},
        )
        self.service.publish_home_tab.assert_not_called()
