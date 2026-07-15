# 커리큘럼 상세

> 원본: [../components/CURRICULUM_DETAIL.md](../components/CURRICULUM_DETAIL.md) · 로드맵: [00_ROADMAP.md](00_ROADMAP.md)

| 라우트 | 레이아웃 | 접근 |
|---|---|---|
| `/curriculums/:curriculumId` | `PublicLayout` | 전체(비로그인 포함) |

## 목적
커리큘럼 소개와 `섹션 → 레슨` 목차를 모두에게 공개하되, 현재 사용자와 커리큘럼의 관계에 맞는 다음 행동으로 연결하는 공개 페이지. 하나의 공통 골격 위에 관계별 패널만 바뀐다.

## 화면 구성
```text
CurriculumHero
├─ CurriculumIdentity      — 제목, 짧은 소개, 공개 상태
├─ CurriculumMetadata      — 강사, 기간, 섹션·레슨 수
└─ CurriculumPrimaryAction — 현재 관계의 대표 행동 1개(상단 강조)
CurriculumOverview          — 상세 소개·학습 목표
InstructorSummary           — 담당 강사 요약
CurriculumProgress          수강생만 — 진행률·완료 레슨·최근 학습
CurriculumOutline
└─ CurriculumSection[]
   └─ CurriculumLessonItem[]  — 제목, lesson 상태, 연결 라이브 상태, 접근 가능 여부
CurriculumRelationPanel     — 관계에 맞는 패널 1종
├─ InstructorActions         해당 커리큘럼 강사만
├─ EnrolleeActions            수강생만
├─ EnrollmentActions          학생·미수강만
├─ EnrollmentPendingNotice    승인 대기만
├─ NonOwnerInstructorNotice   강사·비운영자 필요 시
└─ GuestActions               비로그인만
CurriculumNotice            — 모집 종료·운영 중단 등 공지
```

## 관계별 구성
| 관계 | 추가 표시 | 주요 행동 |
|---|---|---|
| 해당 커리큘럼 강사 | 공개·모집·진행 상태, 편성 상태, 다음/현재 라이브 | 관리로 이동, 라이브 세션 상세/일정 수정, 사전 점검·강의실 입장, 종료 레슨 VOD 확인 |
| 수강생 | 전체 진행률, 완료 레슨, 마지막 학습, 다음 라이브 | 이어보기, 라이브 세션 상세/입장, VOD 재생, 목차에서 학습 이동 |
| 학생·미수강 | 수강 가능 여부, 수강 방식·기간 | 수강 신청 |
| 수강 승인 대기 | 신청 상태·일시 | 승인 대기 확인, (허용 시) 신청 취소 |
| 강사·비운영자 | 일반 공개 정보 | (정책 허용 시) 수강 신청 |
| 비로그인 | 공개 정보 + 로그인 필요 안내 | 로그인 후 복귀, 학생 회원가입 |

비수강 사용자에게는 레슨 제목까지만 공개하고, 라이브 입장 정보·VOD URL·자료 원본·자막/채팅·AI 근거는 노출하지 않는다. 목차 항목은 "안 보임"이 아니라 "보이지만 잠김"으로 표현한다.

## 대표 행동 우선순위 (상단 `CurriculumPrimaryAction`)
1. 커리큘럼 강사 → 관리 또는 라이브 세션 상세/입장
2. 수강생·진행 중 라이브 있음 → 라이브 입장
3. 수강생·최근 학습 있음 → 이어보기
4. 학생·미수강 → 수강 신청
5. 승인 대기 → 승인 대기 확인
6. 비로그인 → 로그인 후 수강

## 상태
- 로딩: skeleton, 관계·권한 확인 전 관리/수강/입장 버튼 노출 금지
- 정상: 공통 정보 + 관계별 패널, 일부 데이터 실패 시 해당 영역만 재시도
- 찾을 수 없음: 존재하지 않거나 삭제됨 → 커리큘럼 목록으로 유도
- 비공개·접근 제한: 로그인으로 해결 가능하면 복귀 경로 포함해 로그인 이동
- 조회 실패: 일반 오류(재시도) vs 권한 부족을 다르게 표시

## 다음 화면
"관리로 이동" → 커리큘럼 관리 · 라이브 관련 행동 → 라이브 세션 상세/사전 점검/강의실 · "종료 레슨 VOD" → VOD 레슨 · "이어보기"/목차 항목 → 레슨 상세 · "로그인 후 수강" → 로그인(복귀 경로=현재 커리큘럼) · "회원가입" → 회원가입
