# 테스트 전용 GitLab 러너.
#
# 공식 이미지에 **도커 CLI가 없다.** 우리 CI 잡은 전부 `docker run ...`으로 빌드 도구를 띄우므로
# (shell executor 호스트에 Java/Node가 있다는 보장이 없어서 그렇게 짜여 있다) CLI가 필수다.
# 소켓만 마운트하고 CLI를 안 넣으면 첫 잡이 `docker: command not found`로 죽는다.
FROM gitlab/gitlab-runner:v17.11.0

USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends docker.io \
 && rm -rf /var/lib/apt/lists/*
