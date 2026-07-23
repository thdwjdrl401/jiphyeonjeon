# ADR-0029: FE가 이미 부르고 있던 두 경로 구현 — 수강생 레슨 상세·표시 이름 변경, 그리고 목차 `status` 재고정

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-07-23
- **관련**: [0023](0023-asset-presigned-upload.md)(에셋 presigned), [0024](0024-orphan-module-scaffolding.md)(learning 미배선), [0026](0026-catalog-viewer-context.md)(viewerContext·레슨 접근 판정), [0027](0027-frontend-incremental-api-cutover.md)(점진 전환)

## 맥락

프론트 HTTP 어댑터가 부르는 경로 전부를 백엔드 컨트롤러 매핑과 대조한 결과, **호출하지만 서버에 없는 경로가 16개** 나왔다. 대부분은 CP1~CP5 범위(라이브 자막·AI 질의·퀴즈·다시보기 검수)라 지금 만들 대상이 아니지만, 둘은 **이미 구현된 기능의 화면을 막고 있었다**.

- `GET /api/lessons/{lessonId}` — 학생이 목차에서 레슨을 눌러 들어가는 경로. 강사용 `/api/instructor/lessons/{id}`만 있어서 **수강생은 레슨 상세를 아예 열 수 없었다**.
- `PUT /api/me/display-name` — 프로필 저장과 라이브 입장 전 별명 설정 두 곳이 쓴다. `PUT /api/me/profile-image`는 있는데 이름 쪽만 없었다.

여기에 더해, 계약 결정으로 한 번 고쳤던 필드명이 되돌아가 있었다.

- [e331a1c](#)에서 목차 레슨 상태를 `lessonStatus` → `status`로 통일했는데(관리 응답 `LessonView`와 같은 이름), 이후 viewerContext를 추가한 커밋에서 `OutlineLesson`이 다시 `lessonStatus`로 작성됐다.
- FE 타입·어댑터·화면·테스트는 모두 `status`를 읽는다. 이름이 어긋나면 값이 `undefined`가 되어 **게시된 레슨도 상태 배지가 비고 진입 버튼 분기가 죽는다.**
- mock 데이터 소스는 `status`를 주므로 개발 기본 설정(`VITE_USE_MOCK_API` 미설정 = mock)에서는 이 편차가 보이지 않았다.
- 회귀가 안 잡힌 이유가 분명하다 — 계약 테스트가 `outline[0].lessons[0].liveSession.status`는 단정하는데 **레슨 자신의 상태 필드는 어디서도 단정하지 않았다.**

## 결정

### 1. 목차 레슨 상태 필드는 `status`, 이름 자체를 계약 테스트로 못박는다

`OutlineLesson.lessonStatus` → `status`로 되돌리고, 필드명을 검증하는 테스트를 추가한다.

```java
.andExpect(jsonPath("$.outline[0].lessons[0].status").value("PUBLISHED"))
.andExpect(jsonPath("$.outline[0].lessons[0].lessonStatus").doesNotExist())
```

값만 보는 단정으로는 부족하다 — 이름이 바뀌면 경로가 통째로 사라져 `value()` 검사도 함께 사라질 뿐이라 `doesNotExist()`를 짝으로 둔다. 레코드 컴포넌트에도 "되돌리지 말 것"을 사유와 함께 주석으로 남긴다.

### 2. `GET /api/lessons/{lessonId}` — 소유권이 아니라 **수강 관계**로 여는 레슨 상세

게이트 규칙은 **목차의 `access` 판정과 같은 것을 쓴다**. 목차에서 "열림"이라 표시해 놓고 실제로 열면 막히는 어긋남을 만들지 않기 위해서다.

| 상황 | 응답 | 이유 |
|---|---|---|
| 레슨·섹션·커리큘럼 없음 | 404 | |
| 소유 강사 | 200 (초안 포함) | 만든 사람은 자기 초안을 열어야 편집 화면이 뜬다 |
| 활성 수강생 + 게시된 레슨 | 200 | |
| 활성 수강생 + 미게시 레슨 | **404** | 그 사람의 목차엔 없는 레슨이다. 403으로 답하면 초안의 존재가 샌다 |
| 그 외(미수강·대기·타 강사) | **403** `ENROLLMENT_REQUIRED` | 공개 목차가 이미 레슨의 존재를 드러내므로 숨길 것이 없다 |
| 비로그인 | 401 | 경로가 `/api/instructor/**` 밖이라 `anyRequest().authenticated()`가 적용된다 |

403의 코드는 목차 `access.reasonCode`와 **같은 값**을 쓴다. FE가 두 자리를 같은 분기로 다뤄 수강 신청 동선으로 보낼 수 있다.

응답에는 목차에 없는 `description`과 함께 `curriculumId`·`curriculumTitle`·`sectionTitle`을 싣는다 — 레슨 화면이 상위 경로를 다시 조회하지 않아도 되도록.

### 3. 설명은 목차가 아니라 단건 조회에서만 준다

`LessonDirectory`에 `findDetail(lessonId)` + `LessonDetailView`를 추가한다(설명 포함, 상태 무관). 목차용 `LessonOutlineView`에 `description`을 얹는 대안은 **레슨 수만큼 본문이 불어나므로** 택하지 않았다. 게시 여부 판정은 포트가 아니라 호출자(curriculum)가 한다 — 포트에서 미게시를 걸러 버리면 소유 강사에게 자기 초안을 보여줄 수 없다.

### 4. `PUT /api/me/display-name` — `AccountController`에 나란히 둔다

표시 이름만 바꾸고 로그인 식별자(`email`)·역할은 건드리지 않는다. 유일성 검사는 두지 않는다(표시용 이름). 검증은 가입과 같은 `@NotBlank @Size(max=100)`.

## 근거

- **되돌릴 수 있는 회귀는 이름 단정으로만 막힌다.** 타입 검사도, 값 단정도, 양쪽 단면 테스트도 이 종류를 못 잡는다. FE 테스트는 자기가 만든 mock 응답에 `status`를 넣고 `status`를 읽고, BE 테스트는 레슨 상태를 안 봤다 — 둘 다 초록인데 붙이면 깨졌다.
- **게이트를 목차와 같은 규칙으로 두는 것**이 화면 어긋남을 없애는 가장 싼 방법이다. 판정 로직을 `CatalogService` 안에 두어 `lessonAccess`와 나란히 읽히게 했다.
- 404/403 구분 기준은 **"공개 목차가 이미 드러내는가"** 하나다. 드러난 것은 403(권한), 드러나지 않은 것은 404(은닉).

## 대안

| 대안 | 장점 | 단점 |
|---|---|---|
| **레슨 단건 엔드포인트 신설 (선택)** | FE 코드와 그대로 맞음, REST 관례, 목차 본문 안 불어남 | 게이트를 한 벌 더 유지 |
| 목차 `OutlineLesson`에 `description` 추가 후 FE가 파생 | 왕복 1회 감소, 엔드포인트 0개 추가 | 레슨 수 × 설명만큼 목록 본문 증가, 미게시 레슨은 여전히 못 봄, FE 수술 필요 |
| 강사용 엔드포인트의 인가만 완화 | 파일 추가 없음 | `/api/instructor/**`는 SecurityConfig가 강사 전용으로 잠근 경로 — 학생을 넣으려면 그 규칙을 깨야 한다 |

## 영향·후속

- **계약 문서**: [CONTRACT.md](../../CONTRACT.md) §2의 강의·인증 행에 두 경로를 반영했다.
- **FE 쪽 후속(이번 범위 밖 — `frontend/`는 건드리지 않았다)**:
  1. `httpCurriculumManagementService.saveCurriculumManagement`가 마지막에 부르는 `PUT /instructor/curriculums/{id}/materials`는 **여전히 없는 경로**다. 앞의 네 번의 쓰기가 이미 커밋된 뒤 404가 나므로 "저장 실패"를 띄우면서 데이터는 절반만 바뀐다. 쓰기 전에 막거나 호출을 빼야 한다.
  2. `httpLessonService.saveLesson`의 자료 첨부도 같은 모양(마지막 단계 404 → 부분 저장).
  3. 나머지 미구현 경로(라이브 자막·AI·퀴즈·대시보드 요약 등 14개)는 호출하면 404가 나고 화면에서 서버 장애와 구분되지 않는다. `httpProfileService`가 하듯 **명시적 501**로 바꾸면 "미구현"과 "장애"가 갈린다.
- **자료(MATERIAL) 업로드는 이번에도 열지 않았다.** FE는 multipart로 보내는데 [0023]이 정한 것은 presigned 직접 업로드다. 서버 쪽 게이트가 세 곳이라 하나만 풀어서는 통과하지 못한다.

  | 위치 | 막는 방식 |
  |---|---|
  | `AssetController.requireKindAllowed` | `kind == MATERIAL`이면 400 |
  | `AssetService.validateImageRequest` | 5MiB 상한이 **kind와 무관하게** 적용 |
  | `AssetService.complete` | HEAD 재검증의 이미지 MIME 화이트리스트가 **kind와 무관하게** 적용 |

  세 곳을 kind별 정책으로 분기하는 것은 [0023]이 CP3로 미뤄둔 범위라 그대로 둔다.
- **여전히 비는 값**(이번 변경과 무관, 근거 있음): 상세의 `materials`(자료 연결 API 부재), `viewerContext.progress`·레슨 `learning`([0024] learning 미배선), `durationMs`(녹화 완료 webhook 부재).
