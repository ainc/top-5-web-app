import json
import logging
from unittest.mock import Mock

from slack_bolt import Ack
from slack_sdk import WebClient

from listeners.actions.home_actions import (
    make_open_add_modal_callback,
    make_quick_add_callback,
    make_toggle_checkboxes_callback,
    make_week_navigation_callback,
)
from top5.home_view import ACTION_DAY_SELECT, BLOCK_DAY_SELECT
from top5.models import AddTaskResult, Top5ApiError
from top5.service import Top5Service

test_logger = logging.getLogger(__name__)


class TestHomeActions:
    def setup_method(self):
        self.ack = Mock(Ack)
        self.client = Mock(WebClient)
        self.service = Mock(Top5Service)

    def test_quick_add_reads_selected_day_and_refreshes_home(self):
        self.service.add_task_for_slack_user.return_value = AddTaskResult(
            entry_date="2026-11-18",
            day_label="Wed (Nov 18)",
            slot=2,
            title="Prep demo",
            profile_name="Taylor",
        )
        callback = make_quick_add_callback(self.service)
        body = {
            "user": {"id": "U123"},
            "view": {
                "private_metadata": json.dumps({"week_monday": "2026-11-16", "selected_date": "2026-11-17"}),
                "state": {
                    "values": {
                        BLOCK_DAY_SELECT: {
                            ACTION_DAY_SELECT: {"selected_option": {"value": "2026-11-18"}},
                        }
                    }
                },
            },
        }

        callback(
            ack=self.ack,
            body=body,
            client=self.client,
            action={"value": "Prep demo"},
            logger=test_logger,
        )

        self.ack.assert_called_once()
        self.service.add_task_for_slack_user.assert_called_once_with(
            self.client, "U123", "Prep demo", entry_date="2026-11-18"
        )
        self.service.publish_home_tab.assert_called_once_with(
            self.client,
            "U123",
            week_monday="2026-11-16",
            selected_date="2026-11-18",
            status_message='Added to *Wed (Nov 18)*, *Slot 2*: "Prep demo"',
        )

    def test_quick_add_error_publishes_status(self):
        self.service.add_task_for_slack_user.side_effect = Top5ApiError("day_full", "Day is full", 409)
        callback = make_quick_add_callback(self.service)
        body = {
            "user": {"id": "U123"},
            "view": {"private_metadata": json.dumps({"week_monday": "2026-11-16", "selected_date": "2026-11-17"})},
        }

        callback(ack=self.ack, body=body, client=self.client, action={"value": "Task"}, logger=test_logger)

        self.service.publish_home_tab.assert_called_once_with(
            self.client,
            "U123",
            week_monday="2026-11-16",
            selected_date="2026-11-17",
            status_message="*Could not add task:* Day is full",
        )

    def test_week_navigation_publishes_requested_week(self):
        callback = make_week_navigation_callback(self.service)
        body = {
            "user": {"id": "U123"},
            "view": {"private_metadata": json.dumps({"selected_date": "2026-11-17"})},
        }

        callback(ack=self.ack, body=body, client=self.client, action={"value": "2026-11-09"}, logger=test_logger)

        self.ack.assert_called_once()
        self.service.publish_home_tab.assert_called_once_with(
            self.client,
            "U123",
            week_monday="2026-11-09",
            selected_date="2026-11-17",
        )

    def test_open_add_modal_opens_view(self):
        callback = make_open_add_modal_callback()
        body = {"trigger_id": "trig_123"}
        action = {
            "value": json.dumps(
                {
                    "entry_date": "2026-11-17",
                    "day_label": "Tue (Nov 17)",
                    "week_monday": "2026-11-16",
                }
            )
        }

        callback(ack=self.ack, body=body, client=self.client, action=action, logger=test_logger)

        self.ack.assert_called_once()
        self.client.views_open.assert_called_once()
        assert self.client.views_open.call_args.kwargs["trigger_id"] == "trig_123"

    def test_toggle_checkboxes_syncs_and_refreshes(self):
        callback = make_toggle_checkboxes_callback(self.service)
        body = {
            "user": {"id": "U123"},
            "view": {"private_metadata": json.dumps({"week_monday": "2026-11-16", "selected_date": "2026-11-17"})},
        }
        action = {
            "action_id": "home_task_checkboxes_2026-11-17",
            "selected_options": [{"value": "2026-11-17|1"}],
        }

        callback(ack=self.ack, body=body, client=self.client, action=action, logger=test_logger)

        self.ack.assert_called_once()
        self.service.toggle_day_tasks_from_checkboxes.assert_called_once_with(
            self.client,
            user_id="U123",
            entry_date="2026-11-17",
            selected_values={"2026-11-17|1"},
            week_monday="2026-11-16",
        )
        self.service.publish_home_tab.assert_called_once_with(
            self.client,
            "U123",
            week_monday="2026-11-16",
            selected_date="2026-11-17",
            status_message=None,
        )
