# 유령 Egress 회수 중계. 표준 라이브러리 HTTP 서버 + redis/jwt/requests 셋뿐이라 얇게 간다.
FROM python:3.12-alpine

RUN pip install --no-cache-dir redis==5.2.1 pyjwt==2.10.1 requests==2.32.3

WORKDIR /app
COPY app.py .

# 호스트 네트워크로 뜬다(LiveKit Redis가 127.0.0.1에만 묶여 있어 같은 netns가 필요하다).
# 포트는 compose에서 PURGE_PORT로 바꿀 수 있다.
CMD ["python", "-u", "app.py"]
