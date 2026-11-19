import os
from dataclasses import dataclass
from pathlib import Path

DEFAULT_TOP5_INGEST_URL = "https://pvgzplrcodbnxqrmncqs.supabase.co/functions/v1/top5-ingest"
DEFAULT_TOP5_WEB_APP_URL = "https://top-5-web-app.netlify.app/"
DEFAULT_TIMEZONE = "America/New_York"
DEFAULT_TIMEOUT_SECONDS = 2.5


def load_dotenv_file(dotenv_path: Path | None = None) -> None:
    target = dotenv_path or (Path(__file__).resolve().parent.parent / ".env")
    if not target.is_file():
        return
    for raw_line in target.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


@dataclass(frozen=True)
class Settings:
    ingest_url: str
    ingest_secret: str
    web_app_url: str = DEFAULT_TOP5_WEB_APP_URL
    timezone_name: str = DEFAULT_TIMEZONE
    request_timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            ingest_url=os.environ.get("TOP5_INGEST_URL", DEFAULT_TOP5_INGEST_URL).strip(),
            ingest_secret=os.environ.get("TOP5_INGEST_SECRET", "").strip(),
            web_app_url=os.environ.get("TOP5_WEB_APP_URL", DEFAULT_TOP5_WEB_APP_URL).strip(),
            timezone_name=os.environ.get("TOP5_TIMEZONE", DEFAULT_TIMEZONE).strip() or DEFAULT_TIMEZONE,
            request_timeout_seconds=float(os.environ.get("TOP5_REQUEST_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS))),
        )
