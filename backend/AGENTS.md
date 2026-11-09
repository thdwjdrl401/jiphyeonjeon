# AGENTS.md — Backend / 컨트롤 플레인 (Spring Boot)

> 📍 정본 규칙: [../AGENTS.md](../AGENTS.md) · 공유 계약: [../docs/CONTRACT.md](../docs/CONTRACT.md) · 아키텍처: [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) · 판단 정책: [../docs/harness/POLICY.md](../docs/harness/POLICY.md)
>
> 이 파일은 backend 작업 시의 스택별 규칙만 다룹니다. 계약·완료 게이트·커밋 규칙은 정본을 따르세요.
> 명세·스켈레톤은 참고용([../docs/decisions/songjeongki/0003](../docs/decisions/songjeongki/0003-greenfield-redesign.md)) — 도메인은 course→section→lesson 중심으로 재설계.

## 스택·환경
- **Spring Boot 4.1 · Java 21**(virtual threads로 blocking I/O 동시성 확대, reactive/JPA 혼합 회피), Gradle 8.14+/9.x, Spring Security, JPA/Hibernate 7. ([../docs/decisions/songjeongki/0009](../docs/decisions/songjeongki/0009-java21-spring-boot-3.md))
- DB: **PostgreSQL + pgvector**, **core 스키마 단독 쓰기**(ai 스키마는 Python) ([../docs/decisions/songjeongki/0005](../docs/decisions/songjeongki/0005-db-postgres-pgvector.md)).
- 큐: **RabbitMQ**(durable 배치 잡 발행) · **Redis**(cache/session + STT/라이브 자막 Streams 소비) ([../docs/decisions/songjeongki/0012](../docs/decisions/songjeongki/0012-hybrid-queue.md)).

## 컨트롤 플레인 책임 (LiveClass AI)
- 인증·유저·**강좌·커리큘럼·강의(course→section→lesson) CRUD**·수강·진도·자료(material) 관리.
- **AI 배치 잡 발행**: PPTX 파싱·chunk·embed·후보(·2-pass 교정)을 RabbitMQ로. **outbox + idempotency**로 유실·중복 방지, AI callback 멱등 처리([CONTRACT §3-1/3-2](../docs/CONTRACT.md#3-내부-계약-확정-인터페이스)). (라이브 STT는 realtime-agent→Redis Streams, 배치 아님.)
- **LiveKit 토큰 발급 + Egress(라이브 녹화) 제어** · **다시보기 재생 URL**(`GET /lessons/{id}/playback`, 인증 seam).
- **업로드 녹화강의 제어**: 전용 API로 MP4 presigned 업로드를 접수하고 `media.transcode` 잡을 발행하며, media-worker callback을 멱등 처리해 전용 HLS 재생 URL을 연다([ADR-0008](../docs/decisions/choinhoo/0008-recorded-lesson-upload-and-hls-transcoding.md)).
- **Redis Streams 소비**: AI가 푸시한 자막·용어·근거를 소비 → Postgres 영속 + WebSocket 전달.
- **채팅·자막 WebSocket** 소유(강의/세션별 채널).
- **AI 프론트도어**(RAG SSE 중계·Q&A): 인증·정책·비용 검증 후 ai-api 호출, 응답을 **요청자에게만** 라우팅.
- **후보→게시**: AI 후보(ai schema)를 강사 수정 후 core read model(`live_caption`·`lesson_glossary_override`·`live_lecture_note` 등)로 반영.

## 계약 준수 (BE가 지킬 것)
- **Response/Request 모델 필드명은 camelCase**([CONTRACT §1](../docs/CONTRACT.md#1-필드명-규칙--camelcase-통일)). DB 컬럼은 snake여도 DTO는 camel.
- **상태코드 규격**: 생성 201, 중복 409, 인증 실패 401, 권한 403([CONTRACT §2](../docs/CONTRACT.md#2-rest-api-api-spring-소유)).
- Python↔Spring 브릿지 메시지는 [CONTRACT §3](../docs/CONTRACT.md#3-내부-계약-확정-인터페이스) 준수.
  realtime-agent의 raw `streamElapsedMs`는 attempt-local 시간이며, 후속 계약으로 변환하기 전에는 세션 상대 ms로 간주하지 않는다.

## 패키지 구조
- **모듈러 모놀리스**: 도메인 모듈(auth·curriculum·lesson·enrollment·learning·live·video·asset·aiintegration·notification·admin + 공용 common) 단일 배포(Spring Modulith, `ModularityTests`). 모듈 간 ID/port로만 연결(다른 모듈 Entity 직접 참조 금지). 도메인은 **course→section→lesson 중심**(live_session은 lesson 연결, [../docs/decisions/songjeongki/0007](../docs/decisions/songjeongki/0007-domain-live-session.md)).

## 빌드·실행·테스트
```bash
cd backend
./gradlew clean build     # 빌드 (Windows: .\gradlew.bat)
./gradlew bootRun         # 실행 (HTTP 8080). API 문서: /swagger-ui/index.html · /v3/api-docs (springdoc, ADR-0009)
./gradlew test            # 테스트
```

## 자물쇠 활성화 (필요 시)
계약 테스트 도입은 [../docs/harness/ENFORCEMENT.md](../docs/harness/ENFORCEMENT.md) 참고. 첫 계약 테스트 템플릿: `docs/harness/templates/ContractTestTemplate.java`.

> 현재 상태: `build.gradle`에 Kurento는 없고 **Postgres·Redis·RabbitMQ(amqp)·MinIO(S3)·LiveKit(server SDK)** 의존성이 들어가 있다.
