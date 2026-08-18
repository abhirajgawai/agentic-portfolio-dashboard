"""Eval helper unit tests: numbers_in parsing + exact-number tolerance.

Pins the q18 gate bug (2026-08-18): the gate reported PASS with
expected=-46.97, found=20.0. Two latent bugs - (1) numbers_in() did not
capture a leading minus, so "-46.97%" parsed as +46.97; (2) the tolerance
check divided by the RAW expected value, so a NEGATIVE denominator flipped
the inequality and any wrong answer passed. Fixing both then surfaced a
FALSE NEGATIVE: natural-language answers ("down 46.97%", no minus sign)
parse as +46.97 and a signed-only check rejects them - so the tolerance
check gained a magnitude mode. All three stages are pinned here without
spawning opencode serve (client.ask is mocked for the end-to-end branch).
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest import mock

# scripts/ is not an installed package (only `portfolio` is); the repo root
# must be importable so `import scripts.eval_agent` resolves, matching the
# layout the eval itself runs in.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import scripts.eval_agent as ev  # noqa: E402

from portfolio.agent.client import AgentResult, ToolCall  # noqa: E402


def test_numbers_in_parses_leading_minus_and_plus():
    assert ev.numbers_in("-46.97%") == [-46.97]
    assert ev.numbers_in("+394.07") == [394.07]
    assert ev.numbers_in("down 46.97") == [46.97]  # no minus -> positive
    assert ev.numbers_in("value -123.45") == [-123.45]  # minus binds to a digit
    assert ev.numbers_in("KPITTECH -46.97% (cost basis)") == [-46.97]


def test_numbers_in_keeps_indian_and_us_commas():
    assert ev.numbers_in("1,23,456.00") == [123456.0]
    assert ev.numbers_in("123,456.00") == [123456.0]
    assert ev.numbers_in("INR 18,71,628.35") == [1871628.35]


def test_within_tolerance_negative_expected():
    # The q18 bug: abs() over a negative denominator was negative -> ANY wrong
    # answer passed. Signed matches pass; the MAGNITUDE match ("down 46.97%",
    # parsed as +46.97) also passes; wrong magnitudes FAIL.
    assert ev._within_tolerance(-46.97, -46.97, 0.02) is True  # signed
    assert ev._within_tolerance(-46.97 + 0.5, -46.97, 0.02) is True  # signed, within 2%
    assert ev._within_tolerance(46.97, -46.97, 0.02) is True  # magnitude (no minus sign)
    assert ev._within_tolerance(20.0, -46.97, 0.02) is False  # wrong magnitude
    assert ev._within_tolerance(9.18, -46.97, 0.02) is False  # wrong magnitude


def test_within_tolerance_positive_expected_unchanged():
    # q16's case: symmetric for a positive expected (behavior unchanged).
    assert ev._within_tolerance(394.07, 394.07, 0.02) is True
    assert ev._within_tolerance(400.0, 394.07, 0.02) is True  # within 2%
    assert ev._within_tolerance(420.0, 394.07, 0.02) is False  # > 2%


def test_exact_branch_rejects_wrong_negative_answer():
    """End-to-end of run_question's exact branch (mocked ask, no server).

    A wrong magnitude to a negative-expected question must FAIL with a
    "number mismatch" reason; the signed answer (-46.97) and the
    natural-language magnitude answer ("down 46.97%", no minus) must PASS.
    """
    q = ev.EvalQuestion("q18", "worst?", "exact", expected=-46.97, tolerance=0.02)
    holder: dict[str, str] = {}

    async def fake_ask(_self, _question, **_kwargs) -> AgentResult:
        return AgentResult(
            question=q.question,
            answer=holder["answer"],
            tool_calls=[
                ToolCall(tool="portfolio_data_holding_returns", args={}, status="completed")
            ],
            turns=1,
        )

    async def run_with(answer: str) -> ev.QuestionResult:
        holder["answer"] = answer
        client = ev.OpenCodeClient(base_url="http://127.0.0.1:1")
        with mock.patch.object(ev.OpenCodeClient, "ask", new=fake_ask):
            return await ev.run_question(client, q, max_turns=12, timeout_s=60.0)

    wrong = asyncio.run(run_with("KPITTECH is down 20.0% from cost."))
    assert not wrong.passed
    assert wrong.found == 20.0
    assert any("number mismatch" in r for r in wrong.reasons)

    right = asyncio.run(run_with("KPITTECH, return -46.97% from cost basis."))
    assert right.passed
    assert right.found == -46.97

    down = asyncio.run(run_with("KPITTECH, down 46.97% from cost basis."))
    assert down.passed  # magnitude match (no minus sign) - the q18 false negative
    assert down.found == 46.97