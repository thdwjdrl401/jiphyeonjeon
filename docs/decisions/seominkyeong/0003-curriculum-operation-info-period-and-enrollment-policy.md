# ADR-0003: 운영 기간은 생성 직후 PATCH로 이어 저장하고, 수강 방식은 입력이 아니라 안내로 다룬다

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 판단 정책: [../../harness/POLICY.md](../../harness/POLICY.md)

- **상태**: 채택
- **일자**: 2026-07-29
- **관련**: Sub Ⅱ, 브랜치 `feat/fe/curriculum-operation-info`, [seominkyeong/0002](0002-curriculum-and-lesson-publish-axes.md), [yoongwanghyeok/0015](../yoongwanghyeok/0015-feature-service-adapter-routing.md)

## 맥락 (Context)

새 커리큘럼 생성 화면(`/instructor/curriculums/new`)의 '운영 정보' 카드를 UX 관점에서 손보려다,
표현 문제 아래에 두 개의 다른 문제가 있는 걸 확인했다.

### 1. 기간 입력값이 저장되지 않는다

`시작일`/`종료일` 입력은 상태로 관리되고 "종료일은 시작일보다 뒤여야 합니다" 검증까지 받지만,
저장 경로 어디에도 실리지 않았다.

| 지점 | 상태 |
|---|---|
| `CurriculumFormPage`의 `createCurriculum()` 호출 인자 | `startsAt`/`endsAt` 없음 |
| `CreateCurriculumRequest` (FE 인터페이스 · BE record) | 기간 필드 없음 |
| `httpCurriculumManagementService.createCurriculum` | `title`·`summary`·`description`·`thumbnailAssetId`만 POST |
| `mockCurriculumManagementService.createCurriculum` | 동일하게 버림 (`putMockCurriculum`이 `period: null` 고정) |
| 관리 화면 `saveCurriculumManagement` | `info = {title, summary, description}`만 PATCH |

카드 설명문이 *"기간은 서버 상세 계약 확정 후 저장되며"* 라고 이미 자백하고 있었다.
그런데 **서버는 이미 받는다** — `PATCH /api/instructor/curriculums/{id}`의 `UpdateCurriculumRequest`가
`startsAt`/`endsAt`을 갖고 있고 `InstructorCurriculumService.updateBasicInfo`가 엔티티에 반영한다.
받지 않는 건 생성 API(`POST /instructor/curriculums`)뿐이다.

이 상태에서 라벨만 다듬으면 "이건 커리큘럼 운영 기간이구나"라는 확신을 준 뒤 그 값을 버리게 된다.
표현 개선이 오히려 손해다.

### 2. 기간의 의미가 세 갈래로 읽힌다

`시작일`/`종료일`이라는 이름만으로는 **학생 모집 기간 · 커리큘럼 운영 기간 · 강의 공개 기간** 중
무엇인지 알 수 없다. 실제 의미는 커리큘럼이 진행되는 기간이다.

### 3. 수강 방식은 서비스 정책상 하나뿐이다

`EnrollmentType` enum에는 `IMMEDIATE`·`APPROVAL_REQUIRED`·`INVITATION_ONLY`가 있고
`CurriculumEnrollmentService.apply`가 세 값을 분기하지만, `InstructorCurriculumService`가 생성 시
`APPROVAL_REQUIRED`로 하드코딩하고 Create·Update DTO 어디에도 `enrollmentType`이 없다.
**서비스가 제공하는 수강 방식은 '강사 승인 후 수강' 하나로 확정이다**(제품 결정).
그런데 화면은 이걸 입력 필드처럼 생긴 카드 섹션(`fixed-policy-field`)으로 보여 주고 있었다 —
고를 수 없는 값을 폼 컨트롤 모양으로 두면 고를 수 있다는 기대만 만든다.

## 결정 (Decision)

1. **기간은 생성 직후 PATCH로 이어 저장한다.** `createCurriculum`이 `POST` 후 기간 입력이 있을 때만
   `PATCH /instructor/curriculums/{id}`를 보낸다. 오케스트레이션은 서비스 구현체가 지고 화면은 모른다
   ([ADR-0015](../yoongwanghyeok/0015-feature-service-adapter-routing.md)의 구현체 단위 경계 유지).
2. **PATCH 실패는 예외로 올리지 않고 `periodSaved: false`로 알린다.** 초안은 이미 만들어졌으므로
   예외를 올리면 화면이 "생성 실패"로 보이고 강사가 같은 커리큘럼을 또 만든다. 관리 화면으로는
   정상 이동하되 토스트로 기간이 빠졌음을 알린다.
3. **기간의 의미는 세 겹으로 못 박는다.** `<fieldset>` legend `커리큘럼 운영 기간`, 라벨
   `운영 시작일`/`운영 종료일`, 그리고 보조 설명에서 오해할 두 후보를 이름으로 지목해 배제한다
   — *"수강 신청을 받는 기간이나 개별 강의 공개일과는 별개예요."* 입력하면 날짜와 총 길이
   (`약 11주 과정`)를 문장으로 되읽어 준다.
4. **수강 방식은 입력이 아니라 안내로 다룬다.** 카드 섹션을 없애고, 운영 기간 아래 `InlineNotice`
   한 줄로 *"수강은 강사 승인 후 수강 방식으로 운영돼요. 학생이 신청하면 승인 대기 상태가 되고,
   강사가 승인해야 수강이 시작됩니다."* 를 알린다. 정할 게 없으면 폼에 자리를 주지 않는다.
5. **고를 수 없는 값을 폼 컨트롤 모양으로 두지 않는다.** 비활성 라디오, "준비 중" 배지,
   입력 필드처럼 생긴 읽기 전용 박스 모두 만들지 않는다.

## 근거 (Rationale)

- **왜 BE에 생성 시 기간 추가를 요청하지 않고 PATCH를 붙였나**: 정석은 `CreateCurriculumRequest`에
  `startsAt`/`endsAt`을 넣는 것이다. 다만 그건 FE/BE 공유 계약 변경이라
  [frontend/AGENTS.md](../../../frontend/AGENTS.md)에 따라 임의로 진행할 수 없고, 이번 작업은 FE 범위로
  받았다. 기존 계약만으로 입력값을 살릴 수 있으면 그게 먼저다. 계약이 정리되면 PATCH 단계는 삭제로 끝난다.
- **왜 부분 실패를 예외로 올리지 않나**: 두 요청 중 뒤가 실패했을 때 사용자에게 남는 건 "초안은 있고
  기간만 없는 상태"다. 이걸 실패로 보고하면 사용자의 다음 행동(재시도 = 중복 생성)이 상태를 더 나쁘게
  만든다. 결과를 있는 그대로 나눠 전달하는 편이 복구 가능하다.
- **왜 수강 방식을 선택형으로 만들지 않나**: 서비스가 제공하는 방식이 '강사 승인 후 수강' 하나이기
  때문이다. 고를 수 있어 보이는데 저장되지 않는 컨트롤은 라벨이 모호한 것보다 나쁘다 — 사용자가 의도를
  갖고 고른 값이 사라진다. [AGENTS.md §4.3](../../../AGENTS.md)의 "가짜 완료 금지"와
  frontend/AGENTS.md의 "'API 준비 중' 안내를 기능 완료처럼 남기지 않는다"에도 걸린다.
- **왜 카드 섹션까지 없앴나**: 정할 게 없는데 폼 안에 필드 모양 박스가 있으면, 강사는 그 앞에서
  "여기서 뭘 정해야 하나"를 한 번 멈춰 판단해야 한다. 정보는 필요하지만 결정은 필요 없으므로,
  입력 자리가 아니라 안내 문구가 맞는 형태다. 카드가 하나 줄어 폼도 짧아진다.
- **선택형 컴포넌트를 미리 만들지 않는 이유**: 한때 `options`/`onChange`를 받아 값이 둘 이상이면
  라디오가 되는 `EnrollmentPolicyField`를 뒀지만, 쓰일 계획이 없는 분기는 읽는 사람에게 "곧 늘어난다"는
  잘못된 신호만 준다. 정책이 실제로 늘어나면 그때 안내 문구를 선택 컨트롤로 바꾸면 된다 —
  안내 한 줄에서 시작하는 편이 되돌리기 쉽다.
- **왜 보조 설명에서 오답을 명시적으로 지목하나**: "커리큘럼 운영 기간"이라고만 쓰면 여전히 모집 기간과
  구분되지 않는다. 혼동 후보를 이름으로 불러 배제하는 편이 짧고 확실하다.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 |
|---|---|---|
| **(선택) 생성 후 PATCH + 기간 표현 개선 + 수강 방식은 안내 문구** | 기존 계약만으로 입력값이 실제 저장됨, BE 대기 없음, 정할 게 없는 자리를 폼에서 뺌 | 요청 2회, 부분 실패 경로를 FE가 책임짐 |
| (기각) 표현만 개선 | 요청 범위에 정확히 부합 | 의미를 확신시킨 뒤 값을 버림 — 개선 전보다 나쁨 |
| (기각) 생성 폼에서 기간 제거 | 거짓말하는 필드가 사라짐 | 초안 단계에서 기간을 넣을 방법이 없어짐. 관리 화면에도 기간 편집기가 없음 |
| (기각) BE `CreateCurriculumRequest`에 기간 추가 | 요청 1회, 구조상 정석 | FE 범위 밖의 계약 변경. **후속으로 제안**(아래) |
| (기각) 수강 방식을 읽기 전용 카드 섹션으로 유지 | 변경 없음 | 정할 게 없는데 폼 필드처럼 보여 판단을 요구함 |
| (기각) 즉시/승인 라디오 노출 또는 선택형 컴포넌트 선제 도입 | 화면이 완성돼 보이고 확장이 싸 보임 | 제공하는 방식이 하나라 고를 게 없음. 저장 API도 없어 선택이 사라짐 |

## 영향·후속 (Consequences)

- **FE 변경**
  - 신규 `CurriculumPeriodFields` — legend·라벨·보조 설명·입력값 되읽기.
  - 패널 제목 `운영 정보` → `커리큘럼 운영 기간`. 수강 방식 카드 섹션(`fixed-policy-field`)을 없애고
    `InlineNotice`(tone=info) 한 줄로 대체 — 관련 CSS도 함께 삭제.
  - `CreateCurriculumRequest`에 `startsAt`/`endsAt`(ISO-8601 or null), `CreateCurriculumResponse`에 `periodSaved`.
  - http 구현체가 POST→(조건부)PATCH를 수행, mock은 `putMockCurriculum`에 기간을 넘겨 저장.
- **BE 변경 없음.** 기존 `PATCH /api/instructor/curriculums/{id}` 계약을 그대로 쓴다.
- **계약 자물쇠**: 공유 계약(필드명·상태코드)이 바뀌지 않으므로 신규 계약 테스트는 불필요하다
  ([POLICY](../../harness/POLICY.md)의 🟢 "UI 문구·스타일"). 다만 이번 변경의 핵심이 "요청이 실제로
  나가는가"이므로 FE 테스트로 고정한다 — PATCH의 URL·바디, 기간이 비면 PATCH 미발신,
  PATCH 실패 시 `periodSaved: false`(예외 아님), 그리고 통합 테스트에서 입력한 기간이 실제로
  커리큘럼에 남는지.
- **후속 1 (BE 제안)**: `CreateCurriculumRequest`에 `startsAt`/`endsAt`을 추가하면 PATCH 단계를 지울 수
  있다. 필요한 변경은 record 필드 2개 + `InstructorCurriculumService.create` 반영 + CONTRACT 갱신.
- **후속 2 (정책이 늘어날 때)**: 서비스가 '즉시 수강' 같은 방식을 추가하기로 하면, BE는
  `enrollmentType`을 Create 또는 Update DTO로 받고(도메인 `EnrollmentType`과 신청 분기
  `CurriculumEnrollmentService.apply`는 이미 있으므로 입구만 열면 된다), FE는 이 안내 `InlineNotice`를
  선택 컨트롤로 바꾼다. 그전까지는 고를 것이 없으므로 안내로 둔다.
- **알려진 공백**: 생성 후 운영 기간을 고칠 화면이 아직 없다(관리 화면 '기본 정보' 탭은 제목·소개·설명만
  다룬다). PATCH가 실패했을 때 사용자가 스스로 복구할 경로가 없다는 뜻이다. 관리 화면의 `info` PATCH가
  같은 엔드포인트를 쓰므로 필드 2개와 상태 hydration만 추가하면 닫힌다 — 이번 범위(생성 화면) 밖이라
  별도로 진행한다.
