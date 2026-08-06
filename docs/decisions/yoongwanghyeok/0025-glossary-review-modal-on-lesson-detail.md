# ADR-0025: 핵심 용어 검수는 강의 상세의 모달로 두고, 기존 upsert API를 그대로 쓴다

> 📍 관련 결정: [songjeongki/0064 용어집은 AI 원본 위에 강사 수정본을 덮는다](../songjeongki/0064-lesson-glossary-two-layers.md) ·
> [jinwoo/0003 PPTX 핵심 용어 추출 접근](../jinwoo/0003-pptx-key-term-extraction-approach.md)

- **상태**: 채택 — FE 구현 완료(백엔드는 ADR-0064의 기존 API를 그대로 재사용, 변경 없음)
- **일자**: 2026-08-07
- **적용 범위**: `LessonDetailPage`, 신설 `GlossaryReviewModal`,
  `liveSessionService.upsertGlossaryTerm`(FE, `PUT /instructor/lessons/{lessonId}/glossary` 호출)

## 맥락

라이브 수업 시작 전 AI가 강의 자료에서 핵심 용어를 한 차례 뽑아 두는데, 강사가 그 결과를
확인하거나 빠진 용어를 더할 화면이 없었다. 백엔드는 이미 `PUT /instructor/lessons/{lessonId}/glossary`로
용어 수정·추가를 지원하고 계약 테스트(`LessonGlossaryContractTest`)까지 갖추고 있었지만
(ADR-songjeongki/0064), 어떤 프론트엔드 화면도 이 엔드포인트를 호출하지 않았다 — 순수 FE 공백이었다.

## 결정

1. **강의 상세 화면**(`LessonDetailPage`)의 "강의 자료" 패널에 "핵심 단어 검수" 버튼을 둔다.
   라이브 사전 점검(`InstructorPreflightPage`)에는 두지 않는다 — 그 화면은 카메라·마이크·서버
   상태를 라이브 시작 몇 분 전에 촌각을 다투며 확인하는 체크리스트라, 용어 정의처럼 여유 있게
   다듬는 작업을 끼워 넣으면 두 성격이 섞인다. 강의 상세는 라이브 며칠 전부터 언제든 들를 수
   있는 화면이라 시간 압박 없이 검수할 수 있다.
2. 버튼은 **모달**(`GlossaryReviewModal`)을 연다. 전용 라우트/페이지를 만들지 않는다 — 검수는
   강의 상세를 보다가 잠깐 들어가 확인하고 나오는 보조 작업이라 전체 화면 전환은 과하다.
3. 새 백엔드 변경 없이 기존 `GET /lessons/{lessonId}/glossary`·
   `PUT /instructor/lessons/{lessonId}/glossary`(ADR-0064)를 그대로 호출한다.
4. 이번 범위는 **수정(정의 고치기)과 추가(빠진 용어 넣기)까지**다. 숨김·삭제(AI가 엉뚱하게 뽑은
   용어를 목록에서 빼는 것)는 넣지 않는다 — ADR-0064가 이미 같은 이유로 범위 밖에 둔 기능이고
   (사용자 결정, "컬럼 하나면 금방 추가 가능"), 이번에도 사용자가 다음으로 미루기로 했다.
5. **라이브 시작을 막지 않는다**(비차단). 지금 스키마에는 "검수 완료" 개념이 없어 강사가 손대지
   않은 AI 원본 용어(MATERIAL)와 "확인해 보고 그대로 둔" 용어를 구분할 수 없다. 강제로 게이트를
   걸면 확인할 것이 없어도 못 넘어가는 상황이 생긴다.
6. 모달 크롬(배경·카드·헤더·닫기 버튼)은 새 클래스를 만들지 않고 기존 `.profile-modal` 패턴
   (`ProfileEditModal`, `AccountWithdrawModal`과 동일)을 재사용한다.

## 근거

- **사전 점검과 성격이 다른 작업이다.** 사전 점검은 초 단위로 압박받는 "지금 당장" 체크리스트고,
  용어 정의는 미리 준비해 두는 콘텐츠 작업이다. 같은 화면에 두면 어느 쪽도 제대로 못 한다.
- **백엔드는 이미 검증돼 있다.** ADR-0064의 계약 테스트가 upsert 동작(멱등 덮어쓰기, 빈 용어
  400, 외부인 403 등)을 이미 보장하므로 이번 변경은 그 위에 FE 호출만 얹으면 된다.
- **기존 모달 관례를 따른다.** 새 시각 언어를 만들지 않고 이미 검증된 `.profile-modal` 크롬을
  재사용해 강사 눈에 낯선 UI 패턴이 하나 더 늘지 않게 한다.

## 대안

| 대안 | 장점 | 단점 |
|---|---|---|
| `InstructorPreflightPage`에 패널 추가 | "라이브 시작 전 점검"이라는 화면 이름과 글자 그대로 맞음 | 카메라·마이크 점검과 다른 성격의 작업이 몇 분짜리 창에 끼어들어 급하게 처리됨 |
| 전용 페이지/라우트 | 용어가 많아져도 여유 있게 보임 | 검수는 부수 작업인데 페이지 전환·뒤로가기 내비게이션까지 얹는 것은 과함 |
| **강의 상세 모달(선택)** | 라이브 며칠 전부터 언제든 여유 있게 검수, 기존 모달 패턴 재사용 | 화면이 좁아 용어가 아주 많아지면 스크롤 부담(현재 규모에서는 문제 없음 — 필요해지면 검색/필터를 더한다) |

## 영향·검증

- 신설: `frontend/src/features/lesson/GlossaryReviewModal.tsx`,
  `liveSessionService.upsertGlossaryTerm`(interface·http·mock 구현).
- 변경: `LessonDetailPage`의 "강의 자료" 패널 action에 강사 전용 "핵심 단어 검수" 버튼.
- 백엔드 변경 없음 — 기존 계약·테스트 그대로. 이 브랜치에서 새 계약 테스트를 추가하지 않은
  이유는 여기 있다(AGENTS.md §4 근거 한 줄): 호출하는 엔드포인트가 이미
  `LessonGlossaryContractTest`로 커버돼 있고, 이번 변경은 그 계약을 소비만 할 뿐 바꾸지 않는다.
- FE 통합 테스트 3개(`CurriculumWorkspace.test.tsx`): 학생 화면에는 버튼이 없음, 강사의
  수정+추가 흐름, 이미 있는 용어명으로 추가를 시도하면 목록에서 고치도록 막고 안내함.
