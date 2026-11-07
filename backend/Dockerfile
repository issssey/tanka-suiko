# APIとワーカーで共通のイメージ。APP_ROLE=api / worker で公開するルートを切り替える。
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080
WORKDIR /srv

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app

# 文語用の UniDic を同梱する場合は fugashi を入れ、辞書を置いて LITERARY_UNIDIC_DIR を指定する
# RUN pip install --no-cache-dir fugashi
# COPY dict/literary /opt/unidic-literary
# ENV LITERARY_UNIDIC_DIR=/opt/unidic-literary

CMD exec uvicorn app.main:get_app --factory --host 0.0.0.0 --port ${PORT}
