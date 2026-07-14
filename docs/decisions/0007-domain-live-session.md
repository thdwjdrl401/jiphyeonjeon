# ADR-0007: 도메인 = live_session 중심 재정의

> 📍 하네스 개요: [../harness/README.md](../harness/README.md) · 아키텍처: [../architecture.md](../architecture.md)

- **상태**: 채택 (보완 2026-07-14: **course→section→lesson** 계층으로 확장)
- **일자**: 2026-07-14
- **관련**: [0003](0003-greenfield-redesign.md), [0005](0005-db-postgres-pgvector.md), [architecture.md](../architecture.md)

> **보완**: 도메인을 **`course → curriculum_section → lesson`** 계층으로 확장(팀 기획서 반영). 옛 `session`은 `lesson`으로 대체, `live_session`은 lesson에 붙는 실시간 세션(1급·필수). core/ai 스키마 분리 + 자막/용어/노트 **2계층**(원본 ai + 수정본 core, 강사 수정). 전체 목록: [architecture.md](../architecture.md) 도메인 모델.

## 맥락
공식 도메인은 `conference`(평등한 참여자가 들어오는 방)다. 제품은 **강의 세션**(강사↔학생 역할, 시간축, 자료, 자막)이라 개념이 맞지 않는다.

## 결정
도메인을 **`session`(live_session) 중심**으로 재정의한다. 공식 `conference`/`user_conference`/`conference_history`/`conference_category`는 폐기한다.

## 근거
- 강의는 역할·시간축·자료·자막이 핵심 → conference 모델과 불일치.
- 명세가 참고용([0003](0003-greenfield-redesign.md))이라 공식 테이블 보존 의무 없음.
- 단일 모델이 이중 모델 동기화(SSOT 위배)보다 깨끗.

## 대안
| 대안 | 장점 | 단점 |
|---|---|---|
| **live_session 중심 (선택)** | 단일·제품 최적 | 공식 ERD와 다름 |
| 공식 유지 + live_session 병행 | 공식 호환 | 이중 모델 동기화 부담 |

## 영향·후속
- 코어: `user`·`session`·`session_participant`(role)·`material`/`material_version`·`transcript_segment`·`chat_message`.
- **Live=VOD 단일 엔티티**: `session`이 `ended`면 그대로 VOD(별도 엔티티 없음).
- 역할(host/student)은 **세션별**.
- 상세 스키마는 [CONTRACT.md](../CONTRACT.md)·구현 단계에서.
