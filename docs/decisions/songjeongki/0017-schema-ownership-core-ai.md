# ADR-0017: core / ai 스키마 소유권 경계 (write-owner 기준)

> 📍 하네스 개요: [../harness/README.md](../../harness/README.md) · 아키텍처: [../ARCHITECTURE.md](../../ARCHITECTURE.md)

- **상태**: 채택
- **일자**: 2026-07-17
- **관련**: [0006](0006-backend-spring-plus-python-ai.md)(Spring/Python 분리), [0005](0005-db-postgres-pgvector.md)(PG+pgvector), [0008](0008-ai-bus-redis-streams-session-clock.md)(AI 버스)

## 맥락
[ADR-0006](0006-backend-spring-plus-python-ai.md)이 `core`(Spring)·`ai`(Python) 스키마를 나눴지만 **"어느 테이블이 어느 쪽 소유인지" 기준은 없었다.** CP0 DDL을 설계하며, 초기 draft가 AI 산출 테이블까지 전부 단일 스키마에 두어 "스키마 공동수정 금지" 계약과 충돌했다. 데이터 흐름을 근거로 경계를 확정한다.

## 결정
소유 기준은 **"런타임에 그 행을 INSERT/UPDATE 하는 서비스"(write-owner)** 다. 원칙(단일쓰기)은 가이드이며, **소유를 옮겨 이벤트·크로스플레인 왕복이 생기면 그게 비효율**이므로 효율을 우선한다.

- **`core` (Spring 단독 쓰기)** — 도메인 전부 + **학생에게 노출되는 read model 전부**: 인증·강좌(curriculum/section/lesson)·수강·진도·라이브 세션·미디어(video_asset)·자료(material_asset)·채팅·북마크·게시된 AI 콘텐츠(자막·용어·챕터·퀴즈, CP2+)·outbox/inbox.
- **`ai` (Python 단독 쓰기)** — **Python이 생산자이자 주 소비자인 것만**: `document_chunk`, `chunk_embedding`(RAG 인덱스), `job_run`, `model_run`(실행 메타). *(CP2/CP3에서 Alembic이 생성)*
- **AI 산출물이 `core`로 가는 경로**: Python은 core에 직접 못 쓴다. 이벤트(outbox → 큐 → Spring 소비 → core write)를 경유한다. "AI 후보(ai) → 강사 게시 → core read model".

## 근거
- **write-owner 소유 = 왕복 최소.** 예: `job_run`을 core에 두면 워커가 상태 전이마다 콜백 이벤트를 보내야 하지만, ai에 두면 워커가 로컬로 쓰고 Spring은 완료 이벤트 1개만 받는다.
- **RAG 인덱스는 ai가 정답.** Python이 임베딩(writer) + 검색(reader) 양쪽이라, core로 빼면 ① 벡터(수천 청크 × 1536차원)를 이벤트버스로 실어날라야 하고 ② 검색이 크로스플레인 읽기가 되며 ③ 임베딩 모델/차원이 Spring에 침투해 플레인 분리가 깨진다. ai 소유가 배치·병렬에도 유리.
- **사용자 노출물은 core.** 자막 등은 강사 수정이 있어(승인 게이트는 없음) Python·Spring 두 서비스가 쓰게 되면 단일쓰기가 깨진다 → core 단일 소유 + AI는 이벤트로만 주입.

## 대안
| 대안 | 장점 | 단점 |
|---|---|---|
| **write-owner 기준(선택)** | 왕복 최소, FK 정합성 유지 | 경계 판단 필요 |
| 전부 core | 단순, 크로스플레인 0 | AI 벡터/실행을 Spring이 못 다룸, 0006 위반 |
| 전부 ai | AI 자기완결 | 사용자 read model이 크로스플레인, 강사 수정 불가 |

## 영향·후속
- **FK는 스키마 내부에서만.** 스키마를 넘는 참조는 물리 FK 없이 논리 `_ref`(앱 검증) — 예: `ai_question.user_ref`.
- **DB 롤**: `core_app`(core 쓰기)·`ai_app`(ai 쓰기), 읽기는 grant로 교차 허용. 마이그레이션 도입 시([0006]) 추가.
- **마이그레이션 주체**: core = Flyway(Spring), ai = Alembic(Python). 상대 스키마 수정 금지.
- CP0 DDL은 core만 생성한다. ai 4테이블은 CP2/CP3에서 Alembic이 생성.
