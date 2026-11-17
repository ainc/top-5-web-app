from slack_bolt import App

from listeners.events.app_home_opened import make_app_home_opened_callback
from top5.service import Top5Service


def register(app: App, service: Top5Service) -> None:
    app.event("app_home_opened")(make_app_home_opened_callback(service))
