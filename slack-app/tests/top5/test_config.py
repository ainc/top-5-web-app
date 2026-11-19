from top5.config import load_dotenv_file


def test_load_dotenv_file_sets_missing_vars(tmp_path, monkeypatch):
    dotenv = tmp_path / ".env"
    dotenv.write_text('SLACK_BOT_TOKEN="xoxb-from-file"\nTOP5_INGEST_SECRET=abc123\n', encoding="utf-8")
    monkeypatch.delenv("SLACK_BOT_TOKEN", raising=False)
    monkeypatch.setenv("TOP5_INGEST_SECRET", "already-set")

    load_dotenv_file(dotenv)

    assert dotenv.is_file()
    import os

    assert os.environ["SLACK_BOT_TOKEN"] == "xoxb-from-file"
    assert os.environ["TOP5_INGEST_SECRET"] == "already-set"
