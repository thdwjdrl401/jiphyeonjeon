# ADR-0066: 공개 전 커리큘럼 상세는 만든 강사에게 열린다 — 남에게는 그대로 404

> 관련 결정: [ADR-0005 레슨에는 초안이 없다](../seominkyeong/0005-lesson-has-no-draft-state.md) ·
> [ADR-0041 강사 저작 읽기와 자동저장](0041-instructor-authoring-reads-and-autosave.md) ·
> [공유 계약 §1 커리큘럼](../../CONTRACT.md)

- **상태**: 채택 — 구현됨(`CatalogService#detail`)
- **일자**: 2026-08-03
- **적용 범위**: `GET /api/curriculums/{curriculumId}`

## 한 줄 결정

`GET /curriculums/{id}`는 **PUBLISHED이거나 요청자가 소유 강사일 때** 200을 준다. 그 외에는
403이 아니라 **404**다.

## 맥락

관리 화면(`/instructor/curriculums/{id}/manage`)의 **"커리큘럼 상세"** 버튼이 `/curriculums/{id}`로
가는데, 서버가 공개 여부만 보고 걸렀다:

```java
curriculumRepository.findByIdAndLifecycleStatus(curriculumId, PUBLISHED)
        .orElseThrow(() -> new CurriculumNotFoundException(...));
```

그래서 **초안 커리큘럼은 만든 사람조차 상세를 볼 수 없었다.** 강사가 자기 화면에서 자기 커리큘럼을
누르면 "커리큘럼을 찾을 수 없어요"가 떴다.

화면은 이미 준비돼 있었다. 상세 헤더에 `DRAFT: '준비 중'` 배지가 있고, `viewerContext`에
`OWNER_INSTRUCTOR` 관계와 `MANAGE_CURRICULUM` 액션이 있으며, `InstructorManagementCard`가
"내가 관리할 수 있는 커리큘럼인가"를 알린다. **응답이 도달한 적이 없었을 뿐이다.**

## 결정

소유 강사는 공개 여부와 무관하게 자기 커리큘럼 상세를 읽는다.

```java
curriculumRepository.findById(curriculumId)
        .filter(found -> found.getLifecycleStatus() == PUBLISHED || isOwner(found, viewer))
        .orElseThrow(() -> new CurriculumNotFoundException(...));
```

**소유권 판정은 `viewerContext`와 같은 함수(`isOwner`)를 쓴다.** 규칙이 갈라지면 "볼 수는 있는데
관리 버튼은 없는" 화면이 나온다.

**남에게는 403이 아니라 404다.** 403은 "여기 뭔가 있다"를 알려 주므로, 존재 자체를 감추는 기존
규칙을 그대로 둔다. 비로그인·수강생·다른 강사 모두 404다.

**볼 수 있는 것과 신청할 수 있는 것은 다른 축이다.** `enrollmentPolicy`는 이미 비공개 커리큘럼을
`UNAVAILABLE`로 계산하므로, 초안 상세를 열어도 신청 버튼이 켜지지 않는다.

## ADR-0041과의 관계

계약에는 "**강사 저작 화면은 공개 카탈로그가 아니라 강사 엔드포인트로 읽는다**"가 있다. 이 결정이
그것을 뒤집지 않는다.

**저작(authoring)과 미리보기(preview)는 다른 일이다.** 저작 화면은 편집 대상을 읽으므로 강사
엔드포인트를 쓴다 — 지금도 관리 화면은 `GET /instructor/curriculums/{id}`로 읽는다. 반면
"커리큘럼 상세" 버튼은 **수강생에게 어떻게 보이는지를 확인하는 것**이라, 공개 카탈로그가 주는
바로 그 응답을 봐야 의미가 있다. 강사용 사본을 따로 만들면 "미리보기와 실제가 다른" 문제를
새로 만든다.

즉 강사가 공개 상세를 읽는 것은 예외가 아니라 **그 화면의 목적**이다.

## 결과

- 강사가 초안 커리큘럼 상세를 열어 공개 전에 확인할 수 있다. 강의 수정 화면의 "커리큘럼 상세로
  돌아가기"도 같은 경로라 함께 풀린다.
- 비공개 커리큘럼의 존재는 여전히 새어 나가지 않는다(404 유지).
- 계약 테스트가 두 방향을 모두 고정한다 — 소유자는 200 + `lifecycleStatus=DRAFT` +
  `enrollmentPolicy.status=UNAVAILABLE`, 그 외(게스트·수강생·다른 강사)는 404.
