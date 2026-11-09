import warnings

import pytest

warnings.filterwarnings("ignore", category=DeprecationWarning)

from app.checkers.llm import LLMChecker  # noqa: E402
from app.config import Settings  # noqa: E402
from app.patterns import load_patterns  # noqa: E402
from app.repository.memory import MemoryRepository  # noqa: E402
from app.service import Service  # noqa: E402
from app.tasks import SyncEnqueuer  # noqa: E402


class FakeLLM:
    """呼び出し内容を記録し、あらかじめ決めた応答を返す。"""

    model = "fake-model"

    def __init__(self, responder=None):
        self.calls = []
        self.responder = responder or (lambda system, user, schema: {"findings": []})

    def complete_json(self, system, user, schema):
        self.calls.append({"system": system, "user": user, "schema": schema})
        return self.responder(system, user, schema)


@pytest.fixture
def patterns():
    return load_patterns()


@pytest.fixture
def fake_llm():
    return FakeLLM()


@pytest.fixture
def service(patterns, fake_llm):
    settings = Settings(tasks_mode="sync", async_delay_seconds=0)
    svc = Service(MemoryRepository(), SyncEnqueuer(), LLMChecker(fake_llm), settings, patterns)

    def handle(p):
        if p.get("kind") == "appreciate":
            svc.run_appreciation(p["tankaId"], p["revisionId"])
        elif p.get("kind") == "purge":
            svc.purge_tanka(p["tankaId"])
        else:
            svc.run_async_check(p["tankaId"], p["revisionId"], p["runId"])

    svc.enqueuer = SyncEnqueuer(handle)
    return svc
