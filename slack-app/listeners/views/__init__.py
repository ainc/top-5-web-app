from slack_bolt import App

from listeners.views.add_task_modal import make_add_task_modal_callback
from top5.home_view import ADD_TASK_MODAL_CALLBACK_ID
from top5.service import Top5Service


def register(app: App, service: Top5Service) -> None:
    app.view(ADD_TASK_MODAL_CALLBACK_ID)(make_add_task_modal_callback(service))
