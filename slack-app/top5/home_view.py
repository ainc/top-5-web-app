import json
from datetime import date
from typing import Any
from uuid import uuid4

from top5.dates import current_local_date, shift_week_iso, week_monday_for
from top5.models import DayBoard, WeekBoard

HOME_VIEW_CALLBACK_ID = "top5_home_view"
ADD_TASK_MODAL_CALLBACK_ID = "top5_add_task_modal"

ACTION_PREV_WEEK = "home_prev_week"
ACTION_THIS_WEEK = "home_this_week"
ACTION_NEXT_WEEK = "home_next_week"
ACTION_REFRESH = "home_refresh"
ACTION_DAY_SELECT = "home_day_select"
ACTION_QUICK_ADD_INPUT = "home_quick_add_input"
ACTION_OPEN_ADD_MODAL = "home_open_add_modal"
ACTION_RETRY_HOME = "home_retry"
ACTION_TASK_CHECKBOX_PREFIX = "home_task_checkboxes_"

BLOCK_DAY_SELECT = "home_day_select_block"
BLOCK_MODAL_TITLE = "modal_task_title_block"
ACTION_MODAL_TITLE = "modal_task_title_input"


def default_selected_date(week: WeekBoard, timezone_name: str) -> str:
    today_iso = current_local_date(timezone_name).isoformat()
    for day in week.days:
        if day.entry_date == today_iso:
            return day.entry_date
    if week.days:
        return week.days[0].entry_date
    return today_iso


def build_home_view(
    week: WeekBoard,
    timezone_name: str,
    web_app_url: str,
    selected_date: str | None = None,
    status_message: str | None = None,
) -> dict[str, Any]:
    today_iso = current_local_date(timezone_name).isoformat()
    active_selected_date = _resolve_selected_date(week, selected_date, timezone_name)
    this_week_monday = shift_week_iso_for_today(today_iso)

    blocks: list[dict[str, Any]] = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"My week · {week.week_label}",
            },
        },
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": (
                        f"*{week.profile_name}* · {week.season_name} · "
                        f"*{week.weekly_points} / {week.weekly_max_points} pts* · "
                        f"<{web_app_url}|Open Top 5 web app>"
                    ),
                }
            ],
        },
    ]

    if status_message:
        blocks.append(
            {
                "type": "context",
                "elements": [{"type": "mrkdwn", "text": status_message}],
            }
        )

    blocks.append(
        {
            "type": "actions",
            "block_id": "home_week_nav_actions",
            "elements": [
                {
                    "type": "button",
                    "action_id": ACTION_PREV_WEEK,
                    "text": {"type": "plain_text", "text": "Previous Week"},
                    "value": shift_week_iso(week.week_monday, -1),
                },
                {
                    "type": "button",
                    "action_id": ACTION_THIS_WEEK,
                    "text": {"type": "plain_text", "text": "This Week"},
                    "value": this_week_monday,
                },
                {
                    "type": "button",
                    "action_id": ACTION_NEXT_WEEK,
                    "text": {"type": "plain_text", "text": "Next Week"},
                    "value": shift_week_iso(week.week_monday, 1),
                },
                {
                    "type": "button",
                    "action_id": ACTION_REFRESH,
                    "text": {"type": "plain_text", "text": "Refresh"},
                    "value": week.week_monday,
                },
            ],
        }
    )

    if week.days:
        blocks.append(_build_top_panels_layout(week, active_selected_date))
        blocks.append(_build_week_grid_table(week, today_iso))
        blocks.append(_build_day_tiles_grid(week, today_iso))

    return {
        "type": "home",
        "callback_id": HOME_VIEW_CALLBACK_ID,
        "private_metadata": json.dumps(
            {
                "week_monday": week.week_monday,
                "selected_date": active_selected_date,
            }
        ),
        "blocks": blocks,
    }


def build_error_home_view(message: str, web_app_url: str) -> dict[str, Any]:
    return {
        "type": "home",
        "callback_id": HOME_VIEW_CALLBACK_ID,
        "blocks": [
            {
                "type": "header",
                "text": {"type": "plain_text", "text": "My week"},
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": (
                        f"*Could not load your Top 5 board*\n{message}\n\n"
                        f"Sign in at <{web_app_url}|Top 5 web app> with your Awesome Inc Google account "
                        "so your Slack email matches your Top 5 profile."
                    ),
                },
            },
            {
                "type": "actions",
                "block_id": "home_error_actions",
                "elements": [
                    {
                        "type": "button",
                        "action_id": ACTION_RETRY_HOME,
                        "text": {"type": "plain_text", "text": "Retry"},
                        "style": "primary",
                        "value": "retry",
                    }
                ],
            },
        ],
    }


def build_add_task_modal(entry_date: str, day_label: str, week_monday: str) -> dict[str, Any]:
    return {
        "type": "modal",
        "callback_id": ADD_TASK_MODAL_CALLBACK_ID,
        "private_metadata": json.dumps(
            {
                "entry_date": entry_date,
                "week_monday": week_monday,
            }
        ),
        "title": {"type": "plain_text", "text": "Add Top 5 task"},
        "submit": {"type": "plain_text", "text": "Add Task"},
        "close": {"type": "plain_text", "text": "Cancel"},
        "blocks": [
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": f"Adding to the next open slot for *{day_label}*",
                    }
                ],
            },
            {
                "type": "input",
                "block_id": BLOCK_MODAL_TITLE,
                "label": {"type": "plain_text", "text": "Task title"},
                "element": {
                    "type": "plain_text_input",
                    "action_id": ACTION_MODAL_TITLE,
                    "placeholder": {"type": "plain_text", "text": "What needs to get done?"},
                    "max_length": 280,
                    "focus_on_load": True,
                },
            },
        ],
    }


def _build_top_panels_layout(week: WeekBoard, selected_date: str) -> dict[str, Any]:
    quick_add_container = _build_quick_add_tile(week, selected_date)
    score_container = _build_score_summary_tile(week)
    return {
        "type": "layout",
        "block_id": "home_top_panels_layout",
        "label": "Quick add and weekly score",
        "rows": [
            {
                "items": [
                    {"width": "wide", "block": quick_add_container},
                    {"width": "narrow", "block": score_container},
                ]
            }
        ],
        "fallback": [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*This week:* {week.weekly_points} / {week.weekly_max_points} pts · Use `/top5` to add tasks.",
                },
            }
        ],
    }


def _build_quick_add_tile(week: WeekBoard, selected_date: str) -> dict[str, Any]:
    day_options = [
        {
            "text": {"type": "plain_text", "text": f"{day.day_name} · {day.date_label}"},
            "value": day.entry_date,
        }
        for day in week.days
    ]
    initial_option = next(
        (option for option in day_options if option["value"] == selected_date),
        day_options[0],
    )
    input_nonce = uuid4().hex[:8]
    return {
        "type": "container",
        "block_id": "home_quick_add_tile",
        "title": {"type": "plain_text", "text": "Quick add task"},
        "has_header_divider": True,
        "child_blocks": [
            {
                "type": "actions",
                "block_id": BLOCK_DAY_SELECT,
                "elements": [
                    {
                        "type": "static_select",
                        "action_id": ACTION_DAY_SELECT,
                        "placeholder": {"type": "plain_text", "text": "Select day"},
                        "options": day_options,
                        "initial_option": initial_option,
                    }
                ],
            },
            {
                "type": "input",
                "block_id": f"home_quick_add_input_block_{input_nonce}",
                "dispatch_action": True,
                "label": {"type": "plain_text", "text": "Task title"},
                "hint": {
                    "type": "plain_text",
                    "text": "Press Enter to add this task to the next open slot (1–5)",
                },
                "element": {
                    "type": "plain_text_input",
                    "action_id": ACTION_QUICK_ADD_INPUT,
                    "placeholder": {"type": "plain_text", "text": "Type a task and press Enter"},
                    "max_length": 280,
                    "dispatch_action_config": {
                        "trigger_actions_on": ["on_enter_pressed"],
                    },
                },
            },
        ],
    }


def _build_score_summary_tile(week: WeekBoard) -> dict[str, Any]:
    return {
        "type": "container",
        "block_id": "home_score_summary_tile",
        "title": {"type": "plain_text", "text": "This week"},
        "subtitle": {"type": "plain_text", "text": f"{week.weekly_points} / {week.weekly_max_points} pts"},
        "has_header_divider": True,
        "child_blocks": [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": "*How scoring works*\nTop 5 complete: *15*\nExercise: *5* · Reading: *5*\nFull day: *25* · Full week: *125*",
                },
            }
        ],
    }


def _build_week_grid_table(week: WeekBoard, today_iso: str) -> dict[str, Any]:
    header_row: list[dict[str, Any]] = [_rich_cell("#", bold=True)]
    for day in week.days:
        suffix = " (Today)" if day.entry_date == today_iso else ""
        header_row.append(_rich_cell(f"{day.day_name} · {day.date_label}{suffix}", bold=True))

    rows: list[list[dict[str, Any]]] = [header_row]
    for slot in range(1, 6):
        row_cells: list[dict[str, Any]] = [_rich_cell(str(slot), bold=True)]
        for day in week.days:
            task = next((item for item in day.tasks if item.slot == slot and item.is_filled), None)
            if task is None:
                row_cells.append({"type": "raw_text", "text": "—"})
            elif task.done:
                row_cells.append(_rich_cell(f"☑ {task.title}", strike=True))
            else:
                row_cells.append(_rich_cell(f"☐ {task.title}"))
        rows.append(row_cells)

    score_row: list[dict[str, Any]] = [_rich_cell("Pts", bold=True)]
    for day in week.days:
        score_row.append(_rich_cell(f"{day.points} pts", bold=True))
    rows.append(score_row)

    column_settings: list[dict[str, Any]] = [{"align": "center"}] + [{"is_wrapped": True} for _ in week.days]
    return {
        "type": "table",
        "block_id": "home_week_grid_table",
        "column_settings": column_settings,
        "rows": rows,
    }


def _build_day_tiles_grid(week: WeekBoard, today_iso: str) -> dict[str, Any]:
    day_items = [
        {"block": _build_day_tile(day, week.week_monday, is_today=(day.entry_date == today_iso))} for day in week.days
    ]
    layout_rows = [{"items": day_items[i : i + 3]} for i in range(0, len(day_items), 3)]
    fallback_lines = [
        f"*{day.day_name} · {day.date_label}:* {day.completed_count}/5 done ({day.points} pts)" for day in week.days
    ]
    return {
        "type": "layout",
        "block_id": "home_day_tiles_grid",
        "label": "Interactive day cards",
        "is_label_visible": True,
        "rows": layout_rows,
        "fallback": [
            {
                "type": "section",
                "text": {"type": "mrkdwn", "text": "\n".join(fallback_lines)},
            }
        ],
    }


def _build_day_tile(day: DayBoard, week_monday: str, is_today: bool) -> dict[str, Any]:
    today_suffix = " (Today)" if is_today else ""
    filled = day.filled_tasks
    filled_slots = {task.slot for task in filled}
    open_slots = [str(slot) for slot in range(1, 6) if slot not in filled_slots]

    child_blocks: list[dict[str, Any]] = []
    if filled:
        options = [
            {
                "text": {"type": "plain_text", "text": _truncate_text(f"{task.slot}. {task.title}", 75)},
                "value": f"{day.entry_date}|{task.slot}",
            }
            for task in sorted(filled, key=lambda item: item.slot)
        ]
        initial_options = [
            {
                "text": {"type": "plain_text", "text": _truncate_text(f"{task.slot}. {task.title}", 75)},
                "value": f"{day.entry_date}|{task.slot}",
            }
            for task in sorted(filled, key=lambda item: item.slot)
            if task.done
        ]
        checkbox_element: dict[str, Any] = {
            "type": "checkboxes",
            "action_id": f"{ACTION_TASK_CHECKBOX_PREFIX}{day.entry_date}",
            "options": options,
        }
        if initial_options:
            checkbox_element["initial_options"] = initial_options
        child_blocks.append(
            {
                "type": "actions",
                "block_id": f"home_day_tasks_{day.entry_date}",
                "elements": [checkbox_element],
            }
        )
    else:
        child_blocks.append(
            {
                "type": "section",
                "text": {"type": "mrkdwn", "text": "_Slots 1–5 open._"},
            }
        )

    if open_slots:
        open_text = f"Open slots: {', '.join(open_slots)}"
    else:
        open_text = "All 5 slots filled"

    child_blocks.append(
        {
            "type": "context",
            "elements": [{"type": "mrkdwn", "text": open_text}],
        }
    )

    if day.has_open_slot:
        child_blocks.append(
            {
                "type": "actions",
                "block_id": f"home_day_add_actions_{day.entry_date}",
                "elements": [
                    {
                        "type": "button",
                        "action_id": ACTION_OPEN_ADD_MODAL,
                        "text": {"type": "plain_text", "text": "Add Task"},
                        "accessibility_label": f"Add task to {day.day_name} {day.date_label}",
                        "value": json.dumps(
                            {
                                "entry_date": day.entry_date,
                                "day_label": f"{day.day_name} ({day.date_label})",
                                "week_monday": week_monday,
                            }
                        ),
                    }
                ],
            }
        )

    return {
        "type": "container",
        "block_id": f"home_day_tile_{day.entry_date}",
        "title": {"type": "plain_text", "text": f"{day.day_name} · {day.date_label}{today_suffix}"},
        "subtitle": {"type": "plain_text", "text": f"{day.completed_count} of 5 done · {day.points} pts"},
        "has_header_divider": True,
        "child_blocks": child_blocks,
    }


def _rich_cell(text: str, bold: bool = False, strike: bool = False) -> dict[str, Any]:
    style: dict[str, bool] = {}
    if bold:
        style["bold"] = True
    if strike:
        style["strike"] = True
    element: dict[str, Any] = {"type": "text", "text": text}
    if style:
        element["style"] = style
    return {
        "type": "rich_text",
        "elements": [
            {
                "type": "rich_text_section",
                "elements": [element],
            }
        ],
    }


def _truncate_text(value: str, max_length: int) -> str:
    if len(value) <= max_length:
        return value
    return value[: max_length - 1].rstrip() + "…"


def _resolve_selected_date(week: WeekBoard, selected_date: str | None, timezone_name: str) -> str:
    if selected_date and any(day.entry_date == selected_date for day in week.days):
        return selected_date
    return default_selected_date(week, timezone_name)


def shift_week_iso_for_today(today_iso: str) -> str:
    return week_monday_for(date.fromisoformat(today_iso)).isoformat()
