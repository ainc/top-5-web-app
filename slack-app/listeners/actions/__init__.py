import re

from slack_bolt import App

from listeners.actions.home_actions import (
    make_day_select_callback,
    make_open_add_modal_callback,
    make_quick_add_callback,
    make_retry_home_callback,
    make_toggle_checkboxes_callback,
    make_week_navigation_callback,
)
from top5.home_view import (
    ACTION_DAY_SELECT,
    ACTION_NEXT_WEEK,
    ACTION_OPEN_ADD_MODAL,
    ACTION_PREV_WEEK,
    ACTION_QUICK_ADD_INPUT,
    ACTION_REFRESH,
    ACTION_RETRY_HOME,
    ACTION_TASK_CHECKBOX_PREFIX,
    ACTION_THIS_WEEK,
)
from top5.service import Top5Service


def register(app: App, service: Top5Service) -> None:
    week_nav = make_week_navigation_callback(service)
    app.action(ACTION_PREV_WEEK)(week_nav)
    app.action(ACTION_THIS_WEEK)(week_nav)
    app.action(ACTION_NEXT_WEEK)(week_nav)
    app.action(ACTION_REFRESH)(week_nav)
    app.action(ACTION_RETRY_HOME)(make_retry_home_callback(service))
    app.action(ACTION_DAY_SELECT)(make_day_select_callback())
    app.action(ACTION_QUICK_ADD_INPUT)(make_quick_add_callback(service))
    app.action(ACTION_OPEN_ADD_MODAL)(make_open_add_modal_callback())
    app.action(re.compile(rf"^{re.escape(ACTION_TASK_CHECKBOX_PREFIX)}"))(make_toggle_checkboxes_callback(service))
