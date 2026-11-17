import os

from slack_bolt import App

from listeners import register_listeners
from top5.config import Settings
from top5.service import Top5Service


def create_app(
    service: Top5Service | None = None,
    token: str | None = None,
    signing_secret: str | None = None,
    token_verification_enabled: bool = True,
) -> App:
    bolt_app = App(
        token=token if token is not None else os.environ.get("SLACK_BOT_TOKEN"),
        signing_secret=signing_secret if signing_secret is not None else os.environ.get("SLACK_SIGNING_SECRET"),
        token_verification_enabled=token_verification_enabled,
    )
    register_listeners(bolt_app, service or Top5Service(Settings.from_env()))
    return bolt_app
