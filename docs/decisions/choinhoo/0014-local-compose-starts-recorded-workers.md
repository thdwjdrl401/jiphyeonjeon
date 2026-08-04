# ADR-0014: 로컬 Compose는 녹화강의 worker까지 기본 기동한다

> 관련 결정: [ADR-0008 녹화강의 업로드·HLS 변환](0008-recorded-lesson-upload-and-hls-transcoding.md) ·
> [ADR-0011 녹화강의 batch STT](0011-recorded-lesson-batch-stt-with-gms-whisper.md) · [실행 가이드](../../../RUN.md)

- **상태**: 채택
- **일자**: 2026-08-04
- **적용 범위**: 로컬 `docker-compose.yml`, WSL 개발 실행 경계

## 맥락

로컬 서비스는 Spring과 React만으로는 녹화강의 영상 변환과 자막 생성을 완료할 수 없다.
그런데 `media-worker`와 `recorded-stt-worker`가 Compose profile로 빠져 있어 `docker compose up -d`
다음에 `npm run dev:wsl`이 worker를 다른 lifecycle로 다시 기동했다. 이로 인해 실행 명령만으로는
로컬 의존 서비스의 완전성을 알기 어렵고, `Ctrl+C` 시 종료 범위도 worker마다 달랐다.

## 결정

- 루트 `docker compose up -d`는 PostgreSQL, Redis, MinIO, RabbitMQ, `media-worker`,
  `recorded-stt-worker`를 모두 기동한다.
- 두 worker의 Compose profile을 제거하고 `restart: unless-stopped`를 유지한다.
- `npm run dev:wsl`은 `.env`를 export한 뒤 React, Spring, Gradle compile watch만 관리한다.
- Spring이 STT job을 발행하도록 로컬 `.env`의 `RECORDED_STT_ENABLED=true`를 유지하고,
  Compose 기동 전 `GMS_API_KEY`를 설정한다.
- 로컬 Spring이 아닌 라이브 미디어 플레인(LiveKit·Egress·TURN)과 원격 AI 스택은 기존처럼
  별도 Compose로 운영한다.

## 결과

- 로컬 실행 순서는 `docker compose up -d` 후 `npm run dev:wsl`로 고정된다.
- `npm run dev:wsl`을 종료해도 worker는 인프라와 함께 계속 실행한다.
- worker 코드 변경을 이미지에 반영할 때는 `docker compose up -d --build` 재실행이 필요하다.
- API 필드·상태코드·메시지 계약은 바뀌지 않는다.

## 검증

- `GMS_API_KEY`를 주입한 `docker compose config --services`에 두 worker가 기본 서비스로 포함되는지 확인한다.
- `bash -n scripts/dev-wsl.sh`와 `package.json` JSON parsing으로 실행 스크립트 구문을 확인한다.
