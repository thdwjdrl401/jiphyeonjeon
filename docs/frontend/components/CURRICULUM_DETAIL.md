# LiveClass AI — 커리큘럼 상세 컴포넌트

> 컴포넌트 원칙: [README.md](README.md) · 공통 레이아웃: [COMMON.md](COMMON.md) · 페이지 기준: [PAGES.md](../PAGES.md)

## 1. 목적

커리큘럼 상세는 비로그인 사용자를 포함한 모든 사용자에게 커리큘럼 소개와 `섹션 → 레슨` 목차를 제공하고, 현재 사용자와 커리큘럼의 관계에 맞는 다음 행동으로 연결하는 공개 페이지다.

이 페이지는 하나의 공통 골격을 유지하며 다음 관계에 따라 일부 컴포넌트를 다르게 조합한다.

- 해당 커리큘럼 강사
- 수강생
- 학생·미수강
- 수강 승인 대기 사용자
- 강사·비운영자
- 비로그인

강사 계정이라는 이유만으로 관리 기능을 제공하지 않는다. 반드시 **해당 커리큘럼을 운영하는 강사인지** 확인한다.

## 2. 컴포넌트 트리

```text
CurriculumDetailPage
├─ CurriculumHero
│  ├─ CurriculumIdentity
│  ├─ CurriculumMetadata
│  └─ CurriculumPrimaryAction
├─ CurriculumOverview
├─ InstructorSummary
├─ CurriculumProgress          수강생만
├─ CurriculumOutline
│  └─ CurriculumSection[]
│     └─ CurriculumLessonItem[]
├─ CurriculumRelationPanel
│  ├─ InstructorActions        해당 커리큘럼 강사만
│  ├─ EnrolleeActions          수강생만
│  ├─ EnrollmentActions        학생·미수강만
│  ├─ EnrollmentPendingNotice  승인 대기만
│  ├─ NonOwnerInstructorNotice 강사·비운영자 필요 시
│  └─ GuestActions             비로그인만
└─ CurriculumNotice
```

`CurriculumPrimaryAction`은 별도 기능을 중복 구현하지 않고 현재 관계에 맞는 대표 행동을 `CurriculumRelationPanel`에서 받아 상단에 노출한다.

## 3. 컴포넌트 책임

| 컴포넌트 | 소유 영역 | 책임 |
|---|---|---|
| `CurriculumDetailPage` | `pages` | 상세 조회 결과와 관계별 feature 조합, 페이지 상태 처리 |
| `CurriculumHero` | `features/curriculum` | 대표 이미지·제목·요약·대표 행동 배치 |
| `CurriculumIdentity` | `features/curriculum` | 제목, 짧은 소개, 공개 상태 표시 |
| `CurriculumMetadata` | `features/curriculum` | 강사, 기간, 섹션·레슨 수 등 핵심 정보 표시 |
| `CurriculumOverview` | `features/curriculum` | 상세 소개와 학습 목표 표시 |
| `InstructorSummary` | `features/curriculum` | 담당 강사 요약 정보 표시 |
| `CurriculumProgress` | `features/enrollment` | 수강생의 완료 레슨·진행률·최근 학습 표시 |
| `CurriculumOutline` | `features/curriculum` | 섹션과 레슨 계층 조합 |
| `CurriculumSection` | `features/curriculum` | 섹션 정보와 소속 레슨 목록 표시 |
| `CurriculumLessonItem` | `features/lesson` | lesson 게시 상태와 연결 live session·다시보기 상태, 접근 가능 여부 표시 |
| `CurriculumRelationPanel` | page 조합 | 관계에 맞는 행동·안내 컴포넌트 한 종류 선택 |
| `InstructorActions` | `features/curriculum` | 관리 이동, 예정 live session 상세·입장 등 운영 행동 제공 |
| `EnrolleeActions` | `features/enrollment` | 이어보기, 라이브 입장, 다음 레슨 이동 제공 |
| `EnrollmentActions` | `features/enrollment` | 수강 신청 행동 제공 |
| `EnrollmentPendingNotice` | `features/enrollment` | 수강 승인 대기 상태 안내 |
| `NonOwnerInstructorNotice` | `features/enrollment` | 비운영 강사의 수강 가능 여부 안내 |
| `GuestActions` | `features/auth` | 로그인·회원가입 후 수강 흐름 진입 |
| `CurriculumNotice` | `features/curriculum` | 모집 종료·운영 중단 등 커리큘럼 공지 표시 |

## 4. 공통 표시 영역

다음 정보는 사용자 관계와 무관하게 공개한다.

- 커리큘럼 제목과 대표 이미지
- 짧은 소개와 상세 설명
- 담당 강사 정보
- 전체 진행 기간
- 섹션·레슨 수
- 공개하기로 결정한 섹션·레슨 목차
- 모집·진행·종료 등 커리큘럼 상태

공개 목차와 실제 레슨 콘텐츠 접근은 분리한다. 비수강 사용자가 레슨 제목을 볼 수 있어도 다음 데이터는 내려주거나 노출하지 않는다.

- LiveKit 입장 정보
- VOD 재생 URL
- 수업 자료 원본
- 전체 자막과 채팅
- AI 질문·답변과 상세 근거

## 5. 관계별 구성

### 5.1 해당 커리큘럼 강사

**추가 표시**

- 공개·모집·진행 상태
- 섹션·레슨 편성 상태
- 다음 예정 또는 현재 live session
- 운영상 주의가 필요한 상태

**주요 행동**

- 커리큘럼 관리로 이동
- 예정 live session 상세·일정 수정
- live session 사전 점검 또는 강의실 입장
- 종료 레슨 VOD 확인

### 5.2 수강생

**추가 표시**

- 전체 학습 진행률
- 완료한 레슨
- 마지막으로 학습한 레슨
- 다음 예정 live session

**주요 행동**

- 마지막 학습 지점부터 이어보기
- live session 상세·강의실 입장
- 접근 가능한 VOD 레슨 재생
- 섹션·레슨 목차에서 학습 이동

### 5.3 학생·미수강

**추가 표시**

- 수강 가능 여부
- 수강 방식과 기간
- 수강 후 접근 가능한 기능 안내

**주요 행동**

- 수강 신청
- 수강할 수 없는 경우 사유 확인

### 5.4 수강 승인 대기

**추가 표시**

- 신청 상태
- 신청 일시 또는 처리 안내가 필요한 경우 관련 정보

**주요 행동**

- 승인 대기 확인
- 정책이 허용하면 신청 취소

### 5.5 강사·비운영자

해당 커리큘럼의 관리 권한은 제공하지 않는다.

**추가 표시**

- 일반 공개 정보
- 강사 계정의 타 커리큘럼 수강 가능 여부

**주요 행동**

- 정책이 허용하면 수강 신청
- 허용하지 않으면 안내만 표시

### 5.6 비로그인

**추가 표시**

- 공개 커리큘럼 정보와 공개 목차
- 수강하려면 로그인이 필요하다는 안내

**주요 행동**

- 로그인 후 현재 커리큘럼으로 복귀
- 학생 회원가입으로 이동

## 6. `CurriculumOutline`

### 6.1 기본 구조

```text
CurriculumOutline
└─ CurriculumSection
   ├─ SectionHeader
   └─ CurriculumLessonItem[]
```

### 6.2 섹션 표시

- 섹션 제목
- 섹션 설명 또는 학습 목표가 확정된 경우 해당 정보
- 소속 레슨 수
- 접기·펼치기
- 커리큘럼 안에서의 순서

### 6.3 레슨 표시

- 레슨 제목
- lesson 상태(`DRAFT`·`AI_NOT_READY`·`READY`·`PUBLISHED`)
- 연결 `liveSessionId`와 세션 상태(`DRAFT`·`SCHEDULED`·`OPEN`·`STARTING`·`LIVE`·`ENDING`·`ENDED`·`CANCELLED`·`FAILED`)
- 대표 녹화 자산과 replay 공개 상태
- 예정 일시 또는 재생 시간
- 수강생의 완료 상태
- 미리보기 가능 여부가 도입되면 해당 표시
- 현재 사용자의 접근 가능 여부

### 6.4 관계별 동작

| 관계 | 레슨 항목 동작 |
|---|---|
| 해당 커리큘럼 강사 | 레슨 상태에 따라 상세·라이브·VOD 이동 |
| 수강생 | 접근 가능한 레슨으로 이동 |
| 그 외 사용자 | 공개 정보만 표시하고 보호 레슨 이동 차단 |

목차 전체를 클릭 불가처럼 흐리게 만들기보다 공개 정보와 잠긴 행동을 구분해서 표현한다.

## 7. 대표 행동 결정

페이지 상단에는 현재 사용자에게 가장 중요한 행동 하나를 우선 배치한다.

| 관계·상태 | 대표 행동 예시 |
|---|---|
| 커리큘럼 강사 | 커리큘럼 관리 또는 live session 상세·강의실 입장 |
| 수강생·진행 중 라이브 있음 | 라이브 입장 |
| 수강생·최근 학습 있음 | 이어보기 |
| 학생·미수강 | 수강 신청 |
| 승인 대기 | 승인 대기 확인 |
| 비로그인 | 로그인 후 수강 |

동일한 주요 행동을 상단과 관계 패널에 중복 배치할 수는 있지만, 두 컴포넌트가 서로 다른 상태와 로직을 소유하지 않도록 한다.

## 8. 페이지 상태

### 8.1 로딩

- 커리큘럼 핵심 정보와 목차의 레이아웃을 유지하는 skeleton 표시
- 관계와 권한 확인 전 관리·수강·입장 버튼을 먼저 노출하지 않음

### 8.2 정상

- 공통 정보와 현재 관계에 맞는 행동 표시
- 부분 데이터 조회가 실패하면 가능한 영역은 유지하고 실패 영역만 재시도 제공

### 8.3 찾을 수 없음

- 존재하지 않거나 삭제된 커리큘럼 안내
- 커리큘럼 목록으로 이동

### 8.4 비공개 또는 접근 제한

- 공개 정책상 상세 자체를 볼 수 없을 때 접근 제한 안내
- 로그인으로 해결 가능한 경우 복귀 경로를 포함해 로그인으로 이동

### 8.5 조회 실패

- 일반 네트워크·서버 오류 안내
- 재시도 제공
- 권한 부족과 일반 조회 실패를 같은 오류로 표시하지 않음

## 9. 주요 사용자 행동

- 커리큘럼 관리로 이동
- 수강 신청·취소
- 로그인 또는 회원가입 후 현재 페이지 복귀
- 섹션 접기·펼치기
- 레슨 상세·라이브·VOD로 이동
- 마지막 학습 레슨 이어보기
- 강사 정보 확인

## 10. 필요한 데이터

컴포넌트 설계를 위해 필요한 데이터 범주만 정의하며 실제 필드와 API는 [API_MAP.md](../API_MAP.md)에서 확정한다.

- 커리큘럼 기본 정보
- 커리큘럼 상태와 공개·수강 정책
- 담당 강사 요약
- 섹션과 공개 가능한 레슨 목차
- 현재 사용자의 계정 유형
- 현재 사용자와 커리큘럼의 관계
- 현재 사용자에게 허용된 행동
- 수강생 학습 진행 정보
- 다음 라이브 또는 최근 학습 레슨 요약

프론트엔드는 계정 유형과 커리큘럼 작성자 ID를 조합해 권한을 임의 계산하지 않고 서버가 제공한 관계와 허용 행동을 사용한다.

## 11. 미확정 사항

1. 수강 신청이 즉시 승인, 강사 승인, 초대 중 어떤 방식을 지원할지
2. 강사 계정이 다른 강사의 커리큘럼을 수강할 수 있는지
3. 비수강 사용자에게 섹션·레슨 제목 외 어느 범위까지 공개할지
4. 일부 레슨 미리보기를 제공할지
5. 커리큘럼 상태를 모집·진행·종료 외에 더 세분화할지
6. 수강생 진행률의 완료 판정 기준
7. 섹션에 별도 설명과 학습 목표를 둘지
8. 강사 프로필 상세를 현재 페이지에서 펼칠지 별도 화면으로 이동할지
9. 상단 대표 행동과 우측 관계 패널의 데스크톱 배치
10. 모바일에서 목차와 관계 패널의 표시 순서

## 12. 이후 확인할 기능 후보

초안 검토 후 필요 여부를 판단한다.

- 커리큘럼 찜 또는 관심 등록
- 수강 후기와 평점
- 커리큘럼 공지
- 학습 목표와 선수 지식
- 예상 학습 시간
- 수료 조건과 수료증
- 레슨 미리보기
- 공유하기
- 강사에게 문의

후보 기능은 채택되기 전까지 필수 컴포넌트나 API로 간주하지 않는다.
