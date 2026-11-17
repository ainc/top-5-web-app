from slack_bolt import App

from listeners import actions, commands, events, shortcuts, views
from top5.config import Settings
from top5.service import Top5Service


def register_listeners(app: App, service: Top5Service | None = None) -> None:
    resolved_service = service or Top5Service(Settings.from_env())
    actions.register(app, resolved_service)
    commands.register(app, resolved_service)
    events.register(app, resolved_service)
    shortcuts.register(app, resolved_service)
    views.register(app, resolved_service)
