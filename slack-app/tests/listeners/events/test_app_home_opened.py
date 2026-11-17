import logging
from unittest.mock import Mock

from slack_sdk import WebClient

from listeners.events.app_home_opened import make_app_home_opened_callback
from top5.service import Top5Service

test_logger = logging.getLogger(__name__)


class TestAppHomeOpened:
    def setup_method(self):
        self.client = Mock(WebClient)
        self.service = Mock(Top5Service)
        self.callback = make_app_home_opened_callback(self.service)

    def test_publishes_home_tab(self):
        self.callback(client=self.client, event={"tab": "home", "user": "U123"}, logger=test_logger)
        self.service.publish_home_tab.assert_called_once_with(self.client, "U123")

    def test_ignores_non_home_tab(self):
        self.callback(client=self.client, event={"tab": "messages", "user": "U123"}, logger=test_logger)
        self.service.publish_home_tab.assert_not_called()

    def test_logs_unexpected_exception(self, caplog):
        self.service.publish_home_tab.side_effect = RuntimeError("boom")
        self.callback(client=self.client, event={"tab": "home", "user": "U123"}, logger=test_logger)
        assert "boom" in caplog.text
