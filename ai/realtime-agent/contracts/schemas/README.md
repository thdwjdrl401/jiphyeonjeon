# Realtime agent contract schemas

## 역할

realtime-agent 통신 payload와 AI-side 후보 변경을 JSON Schema 2020-12로 검증한다.

## 구조와 흐름

채택된 schema는 producer와 consumer가 계약 테스트에 함께 사용한다. started/final은 AI 구현 검증 단계의
후보라 아직 Spring·ai-api 소비 계약에 사용하지 않는다.

## 파일 구성

- `dispatch-metadata.schema.json`: LiveKit job metadata의 네 필드와 canonical UUID
- `caption-stream-entry.schema.json`: Redis started·delta·segment.final·completed entry
- `live-agent-status.schema.json`: Spring callback 상태와 실패 오류 구조
- `realtime-agent-health.schema.json`: service liveness와 warm-pool/LiveKit readiness

## 경계와 불변식

모든 object는 `additionalProperties: false`이고 필드명은 camelCase다. 정수형 Redis 값인 `sequence`,
`lastSequence`, `segmentIndex`, raw elapsed 필드는 wire에서 십진 문자열이다. final은 VAD boundary reason과
권위 text를, started는 stream 0의 UTC `audioStartedAt`을 갖는다. 이 두 event type과 필드,
`contractVersion`은 공유 계약 변경 중이며 루트 [`docs/CONTRACT.md`](../../../../docs/CONTRACT.md)와
Spring·ai-api consumer가 채택하기 전에는 확정 wire가 아니다.

## 검증

`tests/test_candidate_contract_schemas.py`가 schema 자체와 [`../fixtures/`](../fixtures/README.md)의 예시를 검증한다.
