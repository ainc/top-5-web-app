from slack_bolt import App

from listeners.shortcuts.add_to_top5 import SHORTCUT_ADD_TO_TOP5, make_add_to_top5_shortcut_callback
from top5.service import Top5Service


def register(app: App, service: Top5Service) -> None:
    app.shortcut(SHORTCUT_ADD_TO_TOP5)(make_add_to_top5_shortcut_callback(service))
