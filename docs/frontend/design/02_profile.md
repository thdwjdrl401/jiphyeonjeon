# 내 프로필

> 원본: [../components/PROFILE.md](../components/PROFILE.md) · 로드맵: [00_ROADMAP.md](00_ROADMAP.md)

| 라우트 | 레이아웃 | 접근 |
|---|---|---|
| `/student/profile`, `/instructor/profile` | `WorkspaceLayout` | 로그인 사용자 본인만 |

## 목적
로그인 사용자가 계정 정보·가입 유형을 확인하고, 프로필 이미지를 관리하는 개인 설정 페이지. 닉네임과 강사 공개 프로필은 수정 API가 준비될 때까지 읽기 전용·준비 중으로 표시한다.

## 화면 구성
```text
ProfileHeader
AccountIdentitySection
├─ AccountIdentitySummary     — 아이디·이름 등 읽기 전용
└─ AccountTypeBadge           — 강사/학생 배지(읽기 전용)
ProfileSummarySection
├─ ProfileAvatar              — 이미지 또는 닉네임 첫 글자 fallback
└─ ProfileEditModal           — 프로필 이미지 선택·검증·저장
InstructorPublicProfileSection   강사만
└─ PendingFeatureNotice       — 공개 소개·전문 분야 편집 준비 중
StudentProfileSummary            학생만  — 수강/완료/다음 학습 요약
AccountSecuritySection
└─ PasswordChangeEntry        — 비밀번호 변경 진입
SessionActions                — 로그아웃
AccountDangerZone
└─ AccountDeletionEntry       — 회원 탈퇴 진입(위험 영역으로 시각적 분리)
```

강사·학생이 같은 페이지·공통 계정 영역을 쓰고, 역할별 영역만 추가된다.

## 역할별 표시
| 영역 | 강사 | 학생 |
|---|---|---|
| 공통 계정 정보 | O | O |
| 공개 소개·전문 분야 편집 준비 안내 | O | — |
| 학습 요약(수강/완료/다음 세션) | — | O |
| 내 커리큘럼으로 이동 | — | O |

## 상태
- 초기 로딩: 역할 확인 전 역할별 영역 노출 금지, skeleton 표시
- 정상: 공통+역할별 영역 표시, 기본 프로필의 수정 버튼으로 모달 진입
- 저장 중/성공: 프로필 이미지 변경만 저장 중 표시, 완료 후 모달을 닫고 영역 근처에 성공 메시지
- 저장 실패: 필드 오류 vs 일반 요청 실패 구분, 입력값 유지
- 일부 조회 실패: 기본 계정 정보는 성공, 역할별 요약만 실패해도 해당 영역만 재시도 표시

## 다음 화면
사이드바 "내 커리큘럼" → 역할별 내 커리큘럼 · 로그아웃 → 웰컴/로그인 · 인증 만료 → 로그인(복귀 경로 보존)

## 디자인 시 참고
- 계정 아이디·가입 유형은 읽기 전용(변경 불가) — 시각적으로 입력 필드와 구분
- 회원 탈퇴는 일반 저장 영역과 분리된 위험 영역(Danger Zone)으로 배치, 확인 다이얼로그 필요
- 프로필 이미지는 JPG·PNG·WEBP, 5MB 이하로 제한하고 presigned 직접 업로드 후 전역 아바타를 갱신한다
- 이메일·가입 유형·닉네임은 현재 읽기 전용으로 표시한다
