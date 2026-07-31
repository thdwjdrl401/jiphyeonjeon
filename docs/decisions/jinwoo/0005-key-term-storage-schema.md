# ADR-0005: PPTX 핵심 용어는 AI 스키마의 자료 버전에 종속해 저장한다

- 상태: 채택
- 일자: 2026-07-30
- 관련: [ADR-0003](0003-pptx-key-term-extraction-approach.md), [ADR-0004](0004-key-term-callback-delivery-timing.md)

## 맥락

PPTX 핵심 용어 추출 결과는 Java가 이후 강의 화면과 용어 기능에서 읽어야 한다. 결과를 `core`에 복제하면
Python 소유 AI 데이터와 Spring 소유 `core`의 쓰기 경계가 섞이고, 콜백 처리·재시도에 따른 중복 저장도 늘어난다.

## 결정

AI 워커가 Alembic으로 소유하는 `ai.material_key_term` 테이블에 결과를 저장한다. 테이블은
`material_version_id`, `term`, `definition`, `created_at`만 둔다. `(material_version_id, term)`이 기본키이며,
`material_version_id`는 `ai.material_version(id)`를 `ON DELETE CASCADE`로 참조한다.

Java는 쓰지 않고, 필요할 때 ACTIVE `ai.material_version`과 조인해 읽는다. Java 읽기용 DB 권한과 API는 실제
소비 기능을 추가하는 별도 작업에서 최소 범위로 부여한다.

## 결과

- 재임베딩된 자료의 이전 용어는 ACTIVE 버전 조인에서 자연스럽게 제외된다.
- 자료 버전을 삭제하면 연관 용어도 자동으로 삭제된다.
- MVP에서는 추출 모델·프롬프트 이력, 별도 용어 ID, 승인 상태, 전역 중복 제거를 저장하지 않는다.
