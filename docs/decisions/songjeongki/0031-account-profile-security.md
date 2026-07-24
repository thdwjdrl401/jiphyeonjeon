# ADR-0031: 계정·프로필·보안 API — 강사 공개 프로필·비밀번호 변경·소프트 탈퇴

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-07-24
- **관련**: [0014](0014-auth-redis-session-cookie.md)(Redis 세션 쿠키), [0023](0023-asset-presigned-upload.md)(프로필 이미지는 별개), [0030](0030-frontend-unimplemented-api-and-partial-writes.md)(이 API들이 FE에서 501이던 자리)

## 맥락

ProfilePage가 부르는 계정 API 4개가 서버에 없어 501이었다([0030]). 도메인 골격은 일부 있었다 — `InstructorProfile` 엔티티·리포지토리·테이블(`core.instructor_profile`)과 `AccountStatus.WITHDRAWN`·`app_user.withdrawn_at` 컬럼은 이미 있고, 강사 요약이 프로필을 **읽는** 경로도 있었다. 없던 것은 **쓰기 API와 서비스 메서드**뿐이라, 읽기 인프라 위에 얹었다.

- `GET·PUT /me/instructor-profile` — 강사 공개 소개(bio)·전문분야(expertise). 카탈로그 강사 소개에 노출된다.
- `PUT /me/password` — 비밀번호 변경.
- `DELETE /me` — 회원 탈퇴.

프로필 이미지(`PUT /me/profile-image`)와 혼동하기 쉬운데 둘은 다르다: 이미지는 **전원 공통**이고 이미 구현돼 있다. 이 ADR의 공개 프로필(bio·expertise)은 **강사 전용**이다 — 학생은 카탈로그에 소개될 일이 없다.

## 결정

### 1. 탈퇴는 소프트 삭제(WITHDRAWN 전이)

하드 삭제는 **성립하지 않는다**. `curriculum.instructor_id`·`enrollment.user_id`·`live_session.instructor_id`가 전부 `ON DELETE CASCADE 없이` `app_user`를 참조해서, 커리큘럼을 하나라도 소유한 강사는 `DELETE`가 FK 위반으로 실패한다. 그리고 강사가 만든 커리큘럼·수강 기록은 탈퇴 후에도 남아야 한다.

소프트 삭제는 인프라가 이미 있다 — `status = WITHDRAWN`으로 바꾸면 `authenticate()`의 `!= ACTIVE` 게이트가 곧바로 로그인을 막는다. `withdrawn_at`에 시각을 남긴다. 멱등이다(이미 WITHDRAWN이면 무시).

### 2. 이메일 tombstone으로 같은 이메일 재가입 허용

`app_user.email`에 UNIQUE 제약이 있어, WITHDRAWN 행이 원본 이메일을 그대로 들고 있으면 재가입이 `existsByEmail`에 막힌다. 탈퇴 순간 이메일을 변형해 자리를 비운다.

```
email → "withdrawn_" + userId + "_" + 원본이메일
```

- `userId`(UUID)를 섞어 유일성을 보장한다 — 타임스탬프보다 확실하고 재가입·재탈퇴 반복에도 안전하다.
- 이 행은 두 겹으로 재로그인이 막힌다: ① `findByEmail(원본)`이 못 찾고 ② 찾아도 `status != ACTIVE`.
- 형식이 깨지지만 무관하다 — `@Email`은 요청 DTO에만 걸리고 DB 컬럼엔 없다.

### 3. 진행 중 라이브가 있으면 탈퇴 불가(409) — SPI 포트로 순환 회피

`auth`는 최하위 모듈이라(`live`·`curriculum`이 `auth`를 참조) `auth`가 `live`를 직접 참조하면 순환이 되어 `ModularityTests`가 막는다. 그래서 "탈퇴해도 되는가"의 판정을 **auth가 인터페이스로 선언하고 live가 구현**한다.

```
auth.api      : interface AccountWithdrawalGuard { void ensureCanWithdraw(UUID); }
              : class WithdrawalBlockedException            (예외도 auth가 소유 → auth 핸들러가 매핑)
live.service  : class LiveWithdrawalGuard implements ...    (진행 상태는 live만 안다)
```

의존 방향은 `live → auth`로 기존 경계와 같다. `AuthService`는 주입된 **모든** 가드를 차례로 물어본다(향후 다른 모듈도 확장 가능). 막는 상태는 실제로 켜져 있는 **STARTING·LIVE·ENDING**만 — SCHEDULED·OPEN은 취소하고 탈퇴할 수 있고, ENDED·CANCELLED·FAILED는 이미 끝났다.

### 4. 세션 파기 — 현재 세션은 항상, 다중 기기는 indexed일 때만

탈퇴 성공 뒤 `SecurityContextLogoutHandler`로 현재 요청 세션을 무효화한다(쿠키 정리 포함). 다른 기기 세션까지 지우려면 Spring Session의 principal 인덱스(`FindByIndexNameSessionRepository`)가 필요한데, **현재는 non-indexed 모드라 그 빈이 없다**. `ObjectProvider`로 optional 주입해서, 있으면 다중 기기까지 지우고 없으면 현재 세션만 지운다.

→ **한계**: 지금은 다른 기기에 남은 세션이 즉시 파기되지 않는다. 그 세션으로는 여전히 인증되지만, 재로그인·민감 작업은 막힌다(status 게이트). 완전 무효화는 **indexed 세션 전환이 선행**이며 별도 과제로 남긴다. `getIfAvailable()` 덕에 전환하면 코드 변경 없이 다중 기기 삭제가 켜진다.

### 5. 강사 전용 강제 + 입력 상한

- `instructor-profile`은 비강사가 부르면 **403**(`AUTH_INSTRUCTOR_ONLY`). FE도 `role === INSTRUCTOR`일 때만 부른다.
- `PUT`은 **upsert** — 가입 시 프로필 행을 만들지 않으므로 첫 저장이 곧 생성이다.
- 카탈로그에 그대로 노출되므로 상한을 둔다: bio ≤ 1000자, expertise ≤ 10개·각 ≤ 30자. 없으면 태그 수·길이가 무제한이라 화면이 깨진다.
- 비밀번호: 현재 비번 불일치 → **401**(`AUTH_PASSWORD_MISMATCH`, 로그인 실패와 같은 계열). 새 비번 형식은 가입과 같은 규칙(`@Size(min=8)` + bcrypt 72바이트).

## 근거

- 읽기 인프라·상태값·컬럼이 이미 있어 **쓰기만 얹으면 됐다** — 새 테이블·마이그레이션 없이 끝났다.
- SPI 포트는 Modulith에서 하위 모듈이 상위 모듈의 사정을 물어보는 표준 방법이다. 이벤트(비동기)로는 "탈퇴 막기"의 동기 거부를 못 한다.
- tombstone은 소프트 삭제 + UNIQUE 재사용의 표준 패턴이다. 원본 이메일을 별도 보관하지 않아도 변형값에 흔적이 남아 감사에 충분하다.

## 대안

| 주제 | 대안 | 기각 이유 |
|---|---|---|
| 탈퇴 | 하드 삭제 | FK가 CASCADE 아님 → 커리큘럼 소유 강사는 삭제 불가. 데이터도 보존돼야 함 |
| 재가입 | WITHDRAWN 행 그대로 두고 재가입 차단 | 같은 이메일 재가입을 원함(결정) |
| 순환 회피 | auth가 live.api 직접 참조 | ModularityTests가 순환으로 막음 |
| 순환 회피 | 탈퇴 오케스트레이션을 curriculum(허브)에 | "회원 탈퇴"가 curriculum에 있는 건 부자연 |
| 세션 | indexed 세션으로 이번에 전환 | 인프라 변경이라 범위 초과 — optional로 두고 후속 |

## 영향·후속

- **검증**: `ModularityTests` 통과(순환 없음), 신규 계약 테스트 12건(`AccountProfileContractTest` 6 + `AccountWithdrawalContractTest` 6), 백엔드 전체 통과.
- **FE**: `httpProfileService`가 이미 이 경로들을 부르므로(현재 501) **FE 수정 없이** 맞물린다. `VITE_USE_MOCK_API=false`에서 프로필 편집·비번 변경·탈퇴가 동작한다.
- **후속(별도 과제)**: ① Spring Session **indexed 전환** → 다중 기기 세션 즉시 파기. ② 탈퇴 시 강사가 소유한 **예정(SCHEDULED) 세션 취소** 여부 — 지금은 막지도 취소하지도 않는다(진행 중만 막음).
- **미해결로 남김**: tombstone 이메일이 쌓인다 — 오래된 WITHDRAWN 계정 정리(리퍼)는 운영 과제.
