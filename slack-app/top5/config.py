import os
from dataclasses import dataclass

DEFAULT_TOP5_INGEST_URL = "https://pvgzplrcodbnxqrmncqs.supabase.co/functions/v1/top5-ingest"
DEFAULT_TOP5_WEB_APP_URL = "https://top-5-web-app.netlify.app/"
DEFAULT_TIMEZONE = "America/New_York"
DEFAULT_TIMEOUT_SECONDS = 2.5


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
