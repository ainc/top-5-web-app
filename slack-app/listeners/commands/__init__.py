from slack_bolt import App

from listeners.commands.top5_command import make_top5_command_callback
from top5.service import Top5Service


def register(app: App, service: Top5Service) -> None:
    app.command("/top5")(make_top5_command_callback(service))
