from concurrent.futures import ThreadPoolExecutor

from app.preprocess.pipeline import preprocess


def test_preprocess_is_thread_safe():
    body = "夕暮れの駅のホームで寂しくて君からの文字何度も読み返す"
    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(lambda _: preprocess(body), range(64)))
    assert all([s.mora for s in r.segments] == [5, 7, 5, 7, 9] for r in results)
