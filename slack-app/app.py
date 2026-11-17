import logging
import os

from slack_bolt.adapter.socket_mode import SocketModeHandler

from top5.bolt_app import create_app


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper())
    bolt_app = create_app()
    app_token = os.environ.get("SLACK_APP_TOKEN")
    if app_token:
        SocketModeHandler(bolt_app, app_token).start()
    else:
        bolt_app.start(port=int(os.environ.get("PORT", "3000")))


if __name__ == "__main__":
    main()
