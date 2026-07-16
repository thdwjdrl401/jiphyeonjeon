# 백엔드(Spring Boot 4.1, Java 21) 멀티스테이지 이미지
# build context = ./backend (docker-compose.prod.yml의 backend.build)
# syntax=docker/dockerfile:1

# ---- build stage : Gradle bootJar ----
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app

# 1) wrapper + 빌드 스크립트 먼저 (의존성 레이어 캐시)
COPY gradlew settings.gradle build.gradle ./
COPY gradle ./gradle
RUN chmod +x gradlew && ./gradlew --version --no-daemon

# 2) 소스 → bootJar (테스트는 CI/로컬 담당이라 이미지 빌드에선 제외)
COPY src ./src
RUN ./gradlew clean bootJar -x test --no-daemon

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
