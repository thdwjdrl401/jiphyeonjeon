# Realtime agent v1 contract schemas

## 역할

realtime-agent v1 통신 payload를 JSON Schema 2020-12로 고정한다.

## 구조와 흐름

Spring dispatch producer, realtime-agent, Redis·HTTP consumer가 같은 schema와 fixture를 각자의 계약 테스트에
사용한다.

## 파일 구성

- `dispatch-metadata.schema.json`: LiveKit job metadata의 네 필드와 canonical UUID
- `caption-stream-entry.schema.json`: Redis started·delta·segment.final·completed entry
- `live-agent-status.schema.json`: Spring callback 상태와 실패 오류 구조
- `realtime-agent-health.schema.json`: service liveness와 warm-pool/LiveKit readiness

## 경계와 불변식

모든 object는 `additionalProperties: false`이고 필드명은 camelCase다. 정수형 Redis 값인 `sequence`,
`lastSequence`, `segmentIndex`, raw elapsed 필드는 wire에서 십진 문자열이다. final은 VAD boundary reason과
권위 text를, started는 stream 0의 UTC `audioStartedAt`을 갖는다. Spring 공유 경계는
[`docs/CONTRACT.md` §3-3~§3-5](../../../../docs/CONTRACT.md#3-내부-계약-확정-인터페이스)에 채택됐다.

## 검증

`tests/test_candidate_contract_schemas.py`가 schema 자체와 [`../fixtures/`](../fixtures/README.md)의 예시를 검증한다.
