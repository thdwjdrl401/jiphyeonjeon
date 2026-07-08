# CONTRACT.md — FE/BE 공유 계약 (정본)

> 📍 하네스 개요: [docs/harness/README.md](harness/README.md) · 정본 규칙: [AGENTS.md](../AGENTS.md)
>
> FE와 BE가 **동시에 지켜야** 어긋나지 않는 계약을 모읍니다. 한쪽이 바꾸면 다른 쪽이 깨지는 항목만.
> 명세 원문: [SPEC.md](SPEC.md) · 구현 상태·함정: [ROADMAP.md](ROADMAP.md)

---

## 1. 필드명 규칙 — **camelCase 통일** (최우선)

> 배경·근거: [decisions/0001-field-name-camelcase.md](decisions/0001-field-name-camelcase.md)

SPEC의 API JSON은 snake/camel을 **혼용**한다. 이는 OCR 오류가 아니라 **명세 자체의 계약 불일치**이며([SPEC.md](SPEC.md) 머리말), 구현에서는 **camelCase로 통일**한다.

### 정정 매핑 (SPEC 표기 → 구현 표기)
| 도메인 | SPEC 원문(혼용) | **구현(통일)** |
|---|---|---|
| 회원 | `user_id` | `userId` |
| 방 카테고리 | `conference_category`, `conferenceCategoryId` | `conferenceCategoryId`(요청), `conferenceCategory`(응답 라벨) |
| 방 시간 | `call_start_time` / `callStartTime` | `callStartTime`, `callEndTime` |
| 방 썸네일 | `thumbnail_url` | `thumbnailUrl` |
| 방 상태 | `is_active` | `isActive` |
| 방 인원 | `joinUsersNum` | `joinUsersNum` (이미 camel) |
| 이력 시간 | `inserted_time` | `insertedTime` |

### SPEC이 특히 어긋난 지점 (주의)
- **방 생성 요청**은 `conferenceCategoryId`(camel), **방 수정 요청**은 `conference_category`(snake) — SPEC이 서로 다름. → 둘 다 `conferenceCategoryId`로 통일.
- **방 목록/상세 응답** 한 객체 안에서 `joinUsersNum`·`callStartTime`(camel)과 `thumbnail_url`·`is_active`(snake) 혼재. → 전부 camelCase.
- **이력 응답**의 중첩 `conference` 객체는 전부 snake. → 전부 camelCase.

---

## 2. API 상태코드·응답 규격

`/api/v1` prefix. 실패 시 상태코드를 SPEC대로 지킨다.

| 엔드포인트 | 성공 | 실패 |
|---|---|---|
| `POST /users` (회원가입) | **201** `{ "message":"Success" }` | — |
| `GET /users/{userId}` (중복확인) | 200(사용가능) | **409** `{ "message":"이미 존재하는 사용자 ID 입니다." }` |
| `PATCH /users/{userId}` (수정) | 200 | — |
| `DELETE /users/{userId}` (탈퇴) | 204 | — |
| `POST /auth/login` | 200 (+JWT) | **404** 계정없음 / **401** 비번불일치 |
| `GET /users/me` | 200 (프로필) | 401/403 |
| `POST /conferences` (방 생성) | **201** (+`conferenceId`) | — |
| `PATCH /conferences/{id}` | 200 (방장만) | 403 |

> ⚠️ 현재 코드 상태(ROADMAP): 회원가입이 200 하드코딩 → **201로 정정 필요**. 로그인 에러 규격 확인 필요.

FE 공용 Axios: 401(세션무효/만료)·403 처리 규칙은 [SPEC.md](SPEC.md) §6 참조.

---

## 3. 기능 ↔ 오너 맵

> 역할 분담 시 채워 넣기. 공유 계약(이 문서·AGENTS.md) 수정은 [CODEOWNERS](../CODEOWNERS)에 따라 리드 승인 필요.

| 마일스톤 | 영역 | 오너 | 관련 계약 |
|---|---|---|---|
| Sub Ⅰ | 인증/회원 (`/auth`, `/users`) | _미정_ | §2 상태코드 |
| Sub Ⅱ | 방 CRUD (`/conferences`) | _미정_ | §1 필드명(최대 함정), §2 |
| Sub Ⅱ | 채팅(STOMP)/WebSocket | _미정_ | 소켓 규격(SPEC) |
| Sub Ⅲ | 화상콜(WebRTC 시그널링) | _미정_ | `user_conference` 동기화 |
| Sub Ⅲ | 이력 (`/histories`) | _미정_ | §1 필드명 |

---

## 4. 계약 변경 절차

1. 변경 전 관련 오너와 합의 → 확정 결정은 [decisions/](decisions/)에 ADR로 기록.
2. FE·BE **양쪽**을 함께 수정.
3. 이 문서와 관련 계약 테스트(활성화됐다면)를 갱신.
4. MR 체크리스트에서 "계약 변경 → 양쪽 반영·문서 갱신" 항목 체크.
