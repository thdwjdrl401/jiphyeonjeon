# Candidate contract fixtures

## 역할

후보 통신 계약의 정상 payload와 callback HMAC signing vector를 재현 가능한 예시로 제공한다.

## 구조와 흐름

schema 테스트가 fixture를 읽어 wire shape를 확인한다. 향후 Java producer·consumer도 동일 파일을 사용해
언어 간 직렬화와 서명이 같은지 비교할 수 있다.

## 파일 구성

- `dispatch-metadata.valid.json`: LiveKit dispatch 정상 예시
- `caption-delta.valid.json`, `caption-completed.valid.json`: Redis 자막 이벤트 정상 예시
- `live-agent-status-*.valid.json`: 성공·실패 callback 예시
- `live-agent-status-signing.valid.json`: timestamp, raw body, 예상 HMAC 서명 고정 vector

## 경계와 불변식

fixture는 설명용 임의 JSON이 아니라 schema와 byte-level 서명 검증 입력이다. 필드 순서나 공백까지 raw body
서명에 영향을 주므로 signing fixture 변경은 양쪽 구현을 함께 검토해야 한다.

## 검증

`tests/test_candidate_contract_schemas.py`, `tests/test_spring_status_callback.py`가 fixture와 구현 결과를 대조한다.
