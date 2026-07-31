# ADR-0009: 프로필 상단 두 카드를 공통 프로필 카드 하나로 합치고, 컴팩트화는 페이지 스코프로 적용한다

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 판단 정책: [../../harness/POLICY.md](../../harness/POLICY.md)

- **상태**: 채택
- **일자**: 2026-07-31
- **관련**: 브랜치 `feat/fe/profile-card-and-scroll-reset`,
  `frontend/src/features/profile/ProfileIdentityCard.tsx`

## 맥락 (Context)

내 프로필 화면(학생·강사 공통)의 상단이 두 패널로 갈라져 있었다.

| 패널 | 내용 |
|---|---|
| 계정 정보 | 이메일, 가입 유형 |
| 기본 프로필 | 프로필 이미지, 표시 이름, **이메일(중복)**, 프로필 수정 버튼 |

**이메일이 두 번 표시**되고 한 계정의 정보가 두 카드로 흩어져 있었다. 또 화면 전체가 정보 밀도가
낮았다 — 코드에서 실측한 값은 다음과 같다.

- `.workspace-page-header`: `min-height: 124px`, `h1`이 `clamp(2.35rem, 4vw, 4rem)`, 여기에 설명 문구까지
- `.workspace-panel`: `padding: 30px`, 헤더에 `margin-bottom: 24px` + `padding-bottom: 19px`
- 학생 학습 요약의 `.metric-card`: `min-height: 140px` × 4개 — 숫자 4개가 큰 높이를 차지
- 자명한 내용을 반복하는 Panel 설명("이메일과 가입 유형은 가입 계정의 기본 정보입니다.")과
  "닉네임과 프로필 이미지를 변경할 수 있습니다"(옆의 "프로필 수정" 버튼과 중복)

CSS 로드 순서는 `global → layout → pages → auth → curriculum-detail → workspace → learning → toast
→ design-system`이라 **`design-system.css`가 마지막에 적용된다.** 위 수치들도 대부분 여기서 온다.

## 결정 (Decision)

1. **두 패널을 `ProfileIdentityCard` 하나로 합친다.** 학생·강사가 **같은 컴포넌트**를 쓰고,
   역할 분기는 배지 라벨뿐이다.
2. **이메일은 화면 전체에서 한 번만 보여 준다.**
3. **가입 유형과 이메일은 읽기 전용**이며 **입력 필드가 아니라 배지·텍스트로** 낸다.
   수정 대상은 기존과 같이 프로필 이미지·표시 이름뿐이고, 둘 다 "프로필 수정" 한 곳으로만 들어간다.
4. **레이블은 `dl`의 `dt`로 붙이고 화면에서는 감춘다**(`visually-hidden`).
5. **레이아웃은 데스크톱 3열**(아바타 │ 이름·가입 유형·이메일 │ 수정 버튼). 정보 위계는
   이름(`h2`) > 가입 유형 배지 > 이메일 > 수정 액션.
   **620px 이하에서는 2열로 바꾸고 수정 버튼을 아래 전체폭으로** 내린다.
6. **컴팩트화는 `.profile-page` 페이지 스코프로만 적용한다.** 공유 컴포넌트(`PageHeader`·`Panel`)에
   변형 prop을 추가하지 않는다.
7. **학습 요약의 `MetricCard` 4개를 한 줄 통계 행(`.profile-stats`)으로 바꾼다.** 숫자 크기는 유지한다.
8. **카드 표면은 `design-system.css`의 공통 카드 규칙 그룹에 `.profile-identity`를 등록해 받아온다.**
9. **역할 표기를 `USER_ROLE_LABEL: Record<UserRole, string>` 매핑으로 모은다.**
10. **죽은 CSS를 지운다** — `.profile-grid`, `.profile-summary-card`.

## 근거 (Rationale)

- **읽기 전용을 입력 필드로 내지 않는 이유**: 테두리 있는 박스에 담으면 눌러서 고칠 수 있는 것처럼
  보인다. 가입 유형과 이메일은 사용자가 바꿀 수 없는 값이라, 고칠 수 있다는 인상을 주면 시도했다
  실패하는 경험이 된다. 배지와 평문은 "표시용"이라는 신호가 분명하다.
- **레이블을 감추는 이유**: 배지에 "학생"이라고 쓰여 있고 이메일은 형태로 알 수 있어 **시각적으로는
  레이블이 군더더기**다(GitHub·Google 계정 화면도 "Email:" 같은 레이블을 붙이지 않는다). 하지만
  스크린리더에는 "가입 유형"·"가입 이메일"이라는 이름이 필요하다. `dt`를 감추면 둘을 동시에 만족한다.
- **모바일에서 버튼을 아래로 내리는 이유**: 3열을 유지하면 이름·이메일이 버튼에 밀려 한 글자씩 끊기고
  버튼도 눌리기 어려울 만큼 좁아진다. 정보 영역의 최소 너비를 확보하는 쪽이 낫다.
- **이메일을 말줄임하지 않고 줄바꿈하는 이유**(`overflow-wrap: anywhere`): 잘라 버리면 **확인해야 할
  계정을 읽을 수 없다.** 이 카드의 목적이 "내가 어떤 계정으로 로그인했는지 확인"이므로 값 전체가 보여야 한다.
- **페이지 스코프로 컴팩트화한 이유**(핵심): `.profile-page .workspace-panel`은 클래스 2개라
  `design-system.css`의 `.workspace-panel`(클래스 1개)을 **파일 순서와 무관하게** 이긴다. 덕분에
  (1) 다른 워크스페이스 화면의 여백 리듬을 건드리지 않고, (2) 공유 컴포넌트에 `compact` prop 같은
  변형 축을 늘리지 않아도 된다. 반대로 `.workspace-panel`을 직접 줄이면 커리큘럼 관리·사전 점검 등
  모든 화면이 함께 바뀐다.
- **공통 카드 규칙 그룹에 등록한 이유**: `design-system.css`가 `border-radius: 0`·`--paper-light`·
  `box-shadow: none`으로 평면·직각 스타일을 만든다. 카드마다 값을 복사하면 디자인 시스템이 바뀔 때
  이 카드만 뒤처진다. 그룹에 넣으면 자동으로 따라간다.
- **역할 매핑을 만든 이유**: `role === 'INSTRUCTOR' ? '강사' : '학생'` 삼항식이 **3곳에 중복**돼
  있었다(ProfilePage 1, GlobalHeader 2). 삼항식은 역할이 늘었을 때 **새 역할을 조용히 "학생"으로
  표시한다.** `Record<UserRole, string>`은 빠뜨리면 타입 검사에서 걸린다.
- **`MetricCard`를 이 페이지에서만 바꾼 이유**: `MetricCard`·`.metric-grid`는 내 커리큘럼·커리큘럼
  관리에서 계속 쓰인다. 컴포넌트 자체를 줄이면 그 화면들의 의도(대시보드 지표를 크게 보여 주기)를
  깬다. 프로필의 학습 요약은 **부가 정보**라 밀도를 높이는 쪽이 맞다.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 |
|---|---|---|
| **(선택) 카드 1개 + `.profile-page` 스코프 컴팩트화** | 이메일 중복 제거, 다른 화면 무영향, 공유 컴포넌트 API 불변 | 페이지 스코프 CSS가 늘어남 |
| (기각) 두 카드 유지하고 이메일만 한쪽에서 제거 | 변경 최소 | 한 계정 정보가 여전히 두 카드로 흩어져 있다 |
| (기각) `PageHeader`·`Panel`에 `compact` prop 추가 | 다른 페이지에서도 재사용 가능 | 공유 컴포넌트에 변형 축이 늘고, 지금 필요한 곳은 한 페이지뿐이다 |
| (기각) `.workspace-panel` 패딩을 전역 축소 | CSS가 단순 | 커리큘럼 관리·사전 점검 등 모든 워크스페이스 화면이 함께 바뀐다(범위 밖) |
| (기각) 가입 유형·이메일을 `readOnly` input으로 | 폼처럼 정렬이 쉬움 | 고칠 수 없는 값이 고칠 수 있어 보인다 |
| (기각) 이메일 말줄임(`text-overflow: ellipsis`) | 한 줄 유지 | 확인해야 할 계정을 읽을 수 없다 |

## 영향·후속 (Consequences)

- **FE**: `features/profile/ProfileIdentityCard.tsx` 신설. `ProfilePage`가 두 `Panel` 대신 이 카드를
  쓰고 루트에 `profile-page` 클래스를 붙인다. `features/auth/types.ts`에 `USER_ROLE_LABEL` 추가,
  `GlobalHeader`의 중복 삼항식 2개 정리.
- **CSS**: `workspace.css`에 `.profile-identity*`·`.profile-stats`·`.profile-page` 규칙 추가,
  `.profile-grid`·`.profile-summary-card` 삭제. `design-system.css`의 공통 카드 규칙 그룹에
  `.profile-identity` 등록, `.profile-stats` 색 보정.
  `MetricCard`·`.metric-grid`·`.identity-list`는 다른 화면에서 계속 쓰여 그대로 둔다.
- **BE·계약**: 없음. 기존 service facade와 Query 훅을 그대로 쓰고 API 호출은 바뀌지 않는다.
  [POLICY](../../harness/POLICY.md) 기준 계약 테스트 대상이 아니다.
- **테스트**: `test/features/profile/ProfileIdentityCard.test.tsx`(9개)와
  `test/integration/ProfilePage.test.tsx`(5개). 화면만 봐서는 회귀를 알 수 없는 것을 못 박았다 —
  **페이지 전체에서 이메일 1회**, 읽기 전용(입력 필드 부재), 색 없이도 구분되는 배지, 이미지 없을 때
  첫 글자 fallback, 긴 닉네임·이메일, 수정 모달 연결과 닫은 뒤 포커스 복귀, 학생·강사 하위 섹션 분기.
- **후속(시각 확인)**: 이 환경에 헤드리스 브라우저가 없어 **데스크톱·모바일 레이아웃을 실제로 렌더해
  눈으로 확인하지는 못했다.** 구조·접근성과 빌드된 CSS 셀렉터는 테스트·빌드 산출물로 확인했으나,
  최종 시각 확인은 사람이 브라우저에서 해야 한다(`/student/profile`, `/instructor/profile`).
- **참고**: 스크롤 초기화는 [ADR-0008](0008-route-scroll-reset-policy.md)로 분리해
  `feat/fe/route-scroll-reset` 브랜치에서 따로 다룬다.
