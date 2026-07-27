# Candidate contract schemas

## 역할

realtime-agent가 제안하는 AI-side v1 통신 payload를 JSON Schema 2020-12로 고정한다.

## 구조와 흐름

Spring dispatch producer, realtime-agent, 향후 Redis·HTTP consumer가 같은 schema와 fixture를 각자의 계약 테스트에
사용하는 것을 목표로 한다.

## 파일 구성

- `dispatch-metadata.schema.json`: LiveKit job metadata의 네 필드와 canonical UUID
- `caption-stream-entry.schema.json`: Redis `caption.delta`·`caption.stream.completed` entry
- `live-agent-status.schema.json`: Spring callback 상태와 실패 오류 구조

## 경계와 불변식

모든 object는 `additionalProperties: false`이고 필드명은 camelCase다. 정수형 Redis 값인 `sequence`,
`lastSequence`, `streamElapsedMs`도 wire에서는 십진 문자열이다. 이 schema는 아직
[`../../../../docs/CONTRACT.md`](../../../../docs/CONTRACT.md)에 채택되지 않은 후보 계약이다.

## 검증

`tests/test_candidate_contract_schemas.py`가 schema 자체와 [`../fixtures/`](../fixtures/README.md)의 예시를 검증한다.
