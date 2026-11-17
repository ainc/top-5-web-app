from logging import Logger

from slack_sdk import WebClient

from top5.service import Top5Service


def make_app_home_opened_callback(service: Top5Service):
    def app_home_opened_callback(client: WebClient, event: dict, logger: Logger) -> None:
        if event.get("tab") != "home":
            return
        try:
            service.publish_home_tab(client, str(event["user"]))
        except Exception:
            logger.exception("Error publishing Top 5 home tab")

    return app_home_opened_callback
