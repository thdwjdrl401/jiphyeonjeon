# GitHub Actions self-hosted 러너.
#
# 배포 대상 호스트가 가정용 NAT 뒤에 있어 GitHub가 들어올 수 없다. 러너가 밖으로 나가 폴링하는
# 구조라 포트를 열 필요가 없고, 배포 대상과 러너가 같은 호스트라 SSH 키를 주고받을 일도 없다.
#
# 호스트 도커 소켓을 그대로 쓴다(compose 참고). 러너 안에서 도커를 또 띄우지 않는다 —
# 배포가 곧 호스트의 compose 스택을 올리는 일이기 때문이다.
FROM ubuntu:22.04

ARG RUNNER_VERSION=2.330.0
ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl tar gzip git jq sudo unzip \
      libicu70 libssl3 \
 && rm -rf /var/lib/apt/lists/*

# 도커 CLI만 넣는다. 데몬은 호스트 것을 소켓으로 쓴다.
RUN install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc \
 && chmod a+r /etc/apt/keyrings/docker.asc \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu jammy stable" \
      > /etc/apt/sources.list.d/docker.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
 && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash runner
WORKDIR /home/runner/actions-runner

RUN curl -fsSL -o runner.tar.gz \
      "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" \
 && tar xzf runner.tar.gz \
 && rm runner.tar.gz \
 && ./bin/installdependencies.sh \
 && chown -R runner:runner /home/runner

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# runner로 내려간다. 호스트 도커 소켓 접근은 compose에서 group_add로 준다.
USER runner
ENTRYPOINT ["/entrypoint.sh"]
