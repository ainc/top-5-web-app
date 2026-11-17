from dataclasses import dataclass


@dataclass(frozen=True)
class TaskSlot:
    slot: int
    title: str
    done: bool

    @property
    def is_filled(self) -> bool:
        return bool(self.title.strip())


@dataclass(frozen=True)
class DayBoard:
    entry_date: str
    day_name: str
    date_label: str
    tasks: tuple[TaskSlot, ...]
    points: int = 0

    @property
    def filled_tasks(self) -> tuple[TaskSlot, ...]:
        return tuple(task for task in self.tasks if task.is_filled)

    @property
    def completed_count(self) -> int:
        return sum(1 for task in self.filled_tasks if task.done)

    @property
    def has_open_slot(self) -> bool:
        filled_slots = {task.slot for task in self.filled_tasks}
        return len(filled_slots) < 5


@dataclass(frozen=True)
class WeekBoard:
    profile_id: str
    profile_name: str
    season_name: str
    week_monday: str
    week_label: str
    days: tuple[DayBoard, ...]
    weekly_points: int = 0
    weekly_max_points: int = 125


@dataclass(frozen=True)
class AddTaskResult:
    entry_date: str
    day_label: str
    slot: int
    title: str
    profile_name: str


@dataclass(frozen=True)
class ToggleTaskResult:
    entry_date: str
    slot: int
    done: bool


class Top5ApiError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
