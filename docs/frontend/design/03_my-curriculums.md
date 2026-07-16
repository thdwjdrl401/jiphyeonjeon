# 내 커리큘럼

> 원본: [../components/MY_CURRICULUMS.md](../components/MY_CURRICULUMS.md) · 로드맵: [00_ROADMAP.md](00_ROADMAP.md)

| 라우트 | 레이아웃 | 접근 |
|---|---|---|
| `/me/curriculums` | `WorkspaceLayout` | 로그인 사용자 |

## 목적
로그인 사용자가 자신의 계정 유형에 맞는 커리큘럼과 다음 행동을 한 곳에서 확인하는 개인 대시보드. 같은 라우트·레이아웃을 쓰지만 본문은 강사/학생용으로 완전히 다르게 조합한다.

## 화면 구성
```text
MyCurriculumsHeader   — 제목 + 역할별 대표 CTA(강사: 커리큘럼 생성 / 학생: 커리큘럼 탐색)

[강사] InstructorCurriculumDashboard
├─ InstructorCurriculumSummary   — 운영 커리큘럼 수·예정 라이브 등 핵심 수치
├─ InstructorNextLesson          — 가장 가까운 예정/진행 중 레슨 안내
├─ InstructorCurriculumControls  — 검색·상태 필터·정렬
└─ CurriculumGrid → CurriculumCard[]

[학생] StudentLearningDashboard
├─ StudentLearningSummary        — 수강·완료·예정 요약
├─ ContinueLearningSection       — 마지막 학습 이어보기(가장 먼저 노출)
├─ StudentCurriculumControls     — 검색·학습 상태 필터·정렬
└─ CurriculumGrid → CurriculumCard[]
```

## 커리큘럼 카드 — 맥락별 차이
| 맥락 | 카드 우선 정보 | 주요 행동 |
|---|---|---|
| 강사 대시보드 | 운영 상태·섹션/레슨 수·다음 예정 라이브 | 상세, 관리, 다음 라이브 상세/입장 |
| 학생 대시보드 | 강사·진행 상태·완료 레슨 수·진행률·다음/마지막 레슨 | 학습 계속하기, 상세, 진행 중 라이브 입장 |

카드 골격(대표 이미지·제목·강사·상태·행동)은 웰컴·커리큘럼 목록 카드와 동일한 시각 언어를 공유한다.

## 상태 분류(디자인용 예시, 확정 아님)
- 강사: 준비 중 / 모집 중 / 진행 중 / 종료
- 학생: 수강 예정 / 수강 중 / 수강 완료

## 상태
- 로딩: 계정 유형 확인 전 대시보드 노출 금지
- 빈 상태 — 강사: 첫 커리큘럼 생성 안내 / 학생: 커리큘럼 탐색 안내 / 필터 결과 없음: 조건 초기화 우선
- 조회 실패: 목록 vs 요약 영역 실패를 구분해 표시
- 인증 만료: 로그인으로 이동 후 복귀

## 다음 화면
강사 "커리큘럼 생성" → 커리큘럼 생성 · 카드 "상세"/"관리" → 커리큘럼 상세/커리큘럼 관리 · "다음 라이브 상세·입장" → 라이브 세션 상세 · 학생 "학습 계속하기" → 레슨 상세 또는 VOD 레슨 · "커리큘럼 탐색" → 커리큘럼 목록
