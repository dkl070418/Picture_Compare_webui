FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PICTURE_COMPARE_DATA=/data

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt

COPY app ./app

RUN mkdir -p /data

EXPOSE 18765

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "18765"]
