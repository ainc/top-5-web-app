import io
import json
from unittest.mock import patch
from urllib import error

import pytest

from top5.config import Settings
from top5.ingest_client import Top5IngestClient
from top5.models import Top5ApiError


class FakeResponse:
    def __init__(self, payload: dict):
        self._payload = payload

    def read(self) -> bytes:
        return json.dumps(self._payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def test_add_task_posts_secret_and_parses_result():
    settings = Settings(ingest_url="https://example.supabase.co/functions/v1/top5-ingest", ingest_secret="secret-123")
    client = Top5IngestClient(settings)

    with patch("top5.ingest_client.request.urlopen") as mock_urlopen:
        mock_urlopen.return_value = FakeResponse(
            {
                "ok": True,
                "entry_date": "2026-11-17",
                "day_label": "Tue (Nov 17)",
                "slot": 2,
                "title": "Ship Slack app",
                "profile_name": "Taylor",
            }
        )
        result = client.add_task(email="taylor@awesomeinc.org", title="Ship Slack app")

    assert result.entry_date == "2026-11-17"
    assert result.day_label == "Tue (Nov 17)"
    assert result.slot == 2
    assert result.title == "Ship Slack app"
    sent_req = mock_urlopen.call_args.args[0]
    assert sent_req.get_header("X-top5-ingest-secret") == "secret-123"


def test_add_task_raises_structured_http_error():
    settings = Settings(ingest_url="https://example.supabase.co/functions/v1/top5-ingest", ingest_secret="secret-123")
    client = Top5IngestClient(settings)
    err_body = io.BytesIO(
        json.dumps({"ok": False, "error": "day_full", "message": "All 5 slots for Tue (Nov 17) are already filled."}).encode(
            "utf-8"
        )
    )
    http_err = error.HTTPError(
        url=settings.ingest_url,
        code=409,
        msg="Conflict",
        hdrs=None,
        fp=err_body,
    )

    with patch("top5.ingest_client.request.urlopen", side_effect=http_err), pytest.raises(Top5ApiError) as exc_info:
        client.add_task(email="taylor@awesomeinc.org", title="One too many")

    assert exc_info.value.code == "day_full"
    assert exc_info.value.status_code == 409
    assert "All 5 slots" in exc_info.value.message


def test_missing_secret_raises_without_network():
    settings = Settings(ingest_url="https://example.supabase.co/functions/v1/top5-ingest", ingest_secret="")
    client = Top5IngestClient(settings)

    with pytest.raises(Top5ApiError) as exc_info:
        client.get_week(email="taylor@awesomeinc.org")
    assert exc_info.value.code == "missing_ingest_secret"
