# syntax=docker/dockerfile:1
# 파서 지시어는 주석보다 **앞**에 와야 인식된다. 아래로 내리면 그냥 주석이 되고
# cache mount 같은 기능이 조용히 무시된다.

# 백엔드(Spring Boot 4.1, Java 21) 멀티스테이지 이미지
# build context = ./backend (docker-compose.prod.yml의 backend.build)

# ---- build stage : Gradle bootJar ----
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app

# 1) wrapper + 빌드 스크립트 먼저 (의존성 레이어 캐시)
COPY gradlew settings.gradle build.gradle ./
COPY gradle ./gradle
RUN chmod +x gradlew && ./gradlew --version --no-daemon

# 2) 소스 → bootJar (테스트는 CI/로컬 담당이라 이미지 빌드에선 제외)
#
# Gradle 의존성 캐시를 레이어 밖(BuildKit cache)에 둔다. 여기 없으면 소스 한 줄만 바꿔도
# 위 COPY가 무효화되면서 Spring Boot 의존성 전체를 다시 받는다 — 디스크가 느린 호스트에서
# 그 한 단계가 20분을 넘겼다.
#
# `clean`은 뺀다. 매 빌드가 새 레이어라 지울 이전 산출물이 애초에 없고, 증분 컴파일만 막는다.
COPY src ./src
RUN --mount=type=cache,target=/root/.gradle,sharing=locked \
    ./gradlew bootJar -x test --no-daemon

# ---- runtime stage : JRE + jar ----
FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app

# actuator healthcheck용 curl + 비루트 유저
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -r spring && useradd -r -g spring spring

# 실행 jar (rootProject.name=liveclass, version=0.0.1-SNAPSHOT). bootJar은 -plain.jar을 만들지 않음.
COPY --from=build /app/build/libs/liveclass-0.0.1-SNAPSHOT.jar app.jar

USER spring
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
