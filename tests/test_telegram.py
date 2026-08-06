"""Telegram delivery: configured-out must not crash; send path works."""

from __future__ import annotations

import portfolio.alerts.telegram as tg


class _FakeSettings:
    telegram_bot_token = None
    telegram_chat_id = None


def test_unconfigured_returns_false_without_crash() -> None:
    assert tg.send_telegram("hello", settings=_FakeSettings()) is False


def test_send_success(monkeypatch) -> None:
    class _Resp:
        def raise_for_status(self) -> None:
            pass

    captured: dict = {}

    def fake_post(url, json, timeout):
        captured["url"] = url
        captured["json"] = json
        return _Resp()

    monkeypatch.setattr(tg.httpx, "post", fake_post)
    ok = tg.send_telegram("test msg", token="BOT:123", chat_id="42")
    assert ok is True
    assert "BOT:123" in captured["url"]
    assert captured["json"]["text"] == "test msg"


def test_expiry_warning_message(monkeypatch) -> None:
    sent: list[str] = []

    def fake_send(text, settings=None, token=None, chat_id=None):
        sent.append(text)
        return True

    monkeypatch.setattr(tg, "send_telegram", fake_send)
    tg.send_snapshot_expiry_warning("zerodha", "session expired")
    assert any("zerodha" in s and "session expired" in s for s in sent)