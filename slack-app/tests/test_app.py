from unittest.mock import Mock

from top5.bolt_app import create_app
from top5.service import Top5Service


def test_create_app_registers_all_listeners():
    service = Mock(Top5Service)
    bolt_app = create_app(
        service=service,
        token="xoxb-test",
        signing_secret="test-secret",
        token_verification_enabled=False,
    )
    assert len(bolt_app._listeners) == 13
