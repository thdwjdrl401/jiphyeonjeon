# ADR-0007: 프론트 API 문서 = 공통 계약 인덱스 + 도메인별 협의 명세

> API 인덱스: [API_MAP.md](../../frontend/api/API_MAP.md) · 결정 필요 항목: [DECISIONS_PENDING.md](../../frontend/DECISIONS_PENDING.md) · 공유 계약: [CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-07-21
- **적용 범위**: 백엔드 협의 전 프론트 API 요구사항 문서

## 맥락

페이지와 컴포넌트 명세에서 필요한 데이터가 구체화되었지만, 이를 한 API 문서에 모두 넣으면 인증·커리큘럼·레슨·라이브·VOD 계약이 지나치게 길어진다. 또한 프론트가 필요한 API를 적는 시점과 백엔드가 실제 URL·DTO를 확정하는 시점이 다르므로, 제안을 확정 계약처럼 보이게 하면 구현 편차가 생긴다.

## 결정

1. `docs/frontend/api/API_MAP.md`는 공통 호출 규칙, 인증·프로필, 용어, 전체 인덱스를 소유한다.
2. 상세 API는 다음 도메인 문서로 분리한다.
   - 공개 카탈로그
   - 커리큘럼 상세·수강
   - 내 커리큘럼
   - 커리큘럼 관리
   - 레슨·PPTX 관리
   - 라이브
   - VOD·학습·AI·퀴즈
3. 각 항목을 **확정**, **제안**, **협의 필요**, **보류**로 표시한다.
4. 문서는 페이지가 필요한 조회 조합을 먼저 설명하고 endpoint·DTO·오류·실시간 transport를 연결한다.
5. 관계별 UI는 서버의 `relationship`, `allowedActions`, 차단 `reasonCode` 사용을 제안한다.
6. 공통 오류는 안정적인 `code`, 선택적 `fieldErrors`, 비민감 `correlationId`를 사용하고 서버 자유 문구를 그대로 렌더링하지 않는다.
7. 비동기 PPTX·AI·라이브 시작·Egress 작업은 `202 Accepted`와 `operationId`를 사용하고, timeout을 작업 실패로 확정하지 않는다.
8. 중복 영향이 큰 command는 `Idempotency-Key`, 상태 충돌은 `409`와 최신 상태 반환을 제안한다.
9. 브라우저 인증은 정본에 따라 HttpOnly 쿠키+Redis 세션, `credentials: include`, 변경 요청 CSRF를 사용하고 Bearer token을 사용하지 않는다.
10. 현재 API prefix는 [ADR-0016](../songjeongki/0016-drop-api-path-versioning.md)에 따라 **`/api`**다.
11. API 초안에 적힌 필드·endpoint는 백엔드 합의 전 공유 계약이 아니다. 합의되면 `CONTRACT.md`, FE·BE 구현, 계약 테스트를 함께 변경한다.

## 근거

- 도메인별 문서는 백엔드 담당자가 필요한 범위만 검토할 수 있다.
- 상태 라벨은 “화면에 필요함”과 “서버가 합의함”을 구분한다.
- 공통 오류·목록·권한·비동기 원칙을 인덱스에 두면 DTO 표류와 페이지별 예외를 줄인다.
- 제안과 정본을 분리하면 프론트 설계가 백엔드 구현을 일방적으로 확정하는 문제를 피한다.

## 대안

| 대안 | 장점 | 단점 |
|---|---|---|
| 하나의 API 문서 | 검색 위치 하나 | 지나치게 길고 도메인 리뷰 어려움 |
| OpenAPI만 먼저 작성 | 코드 생성 가능 | 제품 정책·화면 상태 합의 전 schema 고착 |
| 페이지별 endpoint 전용 문서 | 화면 이해 쉬움 | 공통 리소스·DTO 중복 |
| **공통 + 도메인 협의 문서(선택)** | 제품 맥락과 계약 경계 유지 | 합의 후 CONTRACT 승격 절차 필요 |

## 영향·후속

- 실제 endpoint 구현 전 `DECISIONS_PENDING.md`의 P0부터 합의한다.
- `course/curriculum` 경로와 식별자 충돌은 공유 계약을 바꾸는 문제이므로 FE 문서만으로 확정하지 않는다.
- API 문서 이동 후 상대 링크 무결성을 검사해야 한다.
- 실제 JSON 필드·상태코드가 확정되면 계약 테스트가 필요하다. 이 ADR 작성 자체는 런타임 계약 변경이 아니다.

