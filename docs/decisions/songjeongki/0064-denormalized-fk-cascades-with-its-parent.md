# ADR-0064: 비정규화 FK는 부모와 함께 지운다 — 삭제를 막는 쪽이 아니라

> 관련 결정: [ADR-0033 학습 진도 배선](0033-learning-progress-wiring.md) ·
> [공유 계약](../../CONTRACT.md)

- **상태**: 채택 — 구현됨(`V21__denormalized_fk_on_delete_cascade.sql`)
- **일자**: 2026-08-03
- **적용 범위**: `core.chat_message.lesson_id`, `core.live_session.curriculum_id`,
  `core.video_asset.lesson_id`, `InstructorCurriculumService#delete`

## 한 줄 결정

편의를 위해 복사해 둔 **비정규화 FK는 `ON DELETE CASCADE`로 둔다.** 단 하나, 지우면 외부
스토리지에 파일이 남는 `video_asset.lesson_id`만 `NO ACTION`으로 두고 **정리 포트를 강제**한다.

## 맥락

### 1. 라이브를 한 강의가 영영 안 지워졌다

강사가 "다시보기 준비 중" 강의를 지우면 **"구조가 동시에 변경되었습니다. 다시 시도해 주세요"**(409)가
떴다. 될 리 없는 일을 재시도하라고 안내한 것이고, 몇 번을 눌러도 결과는 같았다.

실제 원인은 일시적 충돌이 아니라 FK 위반이었다:

```
ERROR: update or delete on table "lesson" violates
       foreign key constraint "chat_message_lesson_id_fkey" on table "chat_message"
```

`chat_message.lesson_id`는 **비정규화 열이다.** 채팅의 진짜 부모는 `live_session`이고
(`chat_message.live_session_id → live_session ON DELETE CASCADE`), `lesson_id`는 조회 편의를 위해
복사해 둔 것이다. 그런데 이 복사본 FK만 기본값(`NO ACTION`)으로 남아 있었다.

`lesson`을 지우면 한 문장 안에서 두 가지가 동시에 일어난다 — `live_session`으로의 CASCADE 정리와,
`chat_message.lesson_id`의 `NO ACTION` 검사다. **검사가 먼저 닿으면 삭제 전체가 거부된다.** 정리가
먼저 닿으면 통과한다. 어느 쪽이 먼저인지는 제약 생성 순서에 딸린 우연이고, 우리는 나쁜 쪽을 뽑았다.

`live_session.curriculum_id`(수강 게이팅용 비정규화, V2)도 정확히 같은 모양이라, 라이브 일정을 한 번
잡은 초안 커리큘럼은 삭제가 막혔다.

### 2. 앞선 수정은 증상 하나만 걷어냈다

`video_asset.lesson_id`가 같은 이유로 삭제를 막던 것은 이미 정리 포트를 추가해 고쳤다. 그 계약
테스트는 녹화만 seed하고 **채팅은 seed하지 않아** 통과했다 — 실제 강의에는 반드시 채팅이 있다.
같은 결함이 남아 있는데 테스트는 초록이었다.

## 결정

**비정규화 FK는 부모와 함께 지운다.** 부모가 사라지면 그 복사본은 가리킬 곳이 없어 의미가 없다.
실제 정리는 이미 부모 경로의 CASCADE가 하고 있었고, 이 제약은 그것을 막기만 했다.

```sql
ALTER TABLE core.chat_message  ... FOREIGN KEY (lesson_id)     ... ON DELETE CASCADE;
ALTER TABLE core.live_session  ... FOREIGN KEY (curriculum_id) ... ON DELETE CASCADE;
```

**`video_asset.lesson_id`만 `NO ACTION`으로 남긴다.** 이 행은 DB 밖(오브젝트 스토리지)에 딸린 것이
있는 유일한 경우다. CASCADE로 열어 주면 행은 깔끔히 사라지고 **HLS 세그먼트와 매니페스트는 아무도
모르는 채 남는다** — 어느 강의 것인지 알 방법도 함께 사라진다. 막히는 편이 새는 편보다 낫다.

대신 막히지 않도록, 삭제 경로가 **반드시 정리 포트를 거치게** 한다. 강의 삭제는 이미 그랬고,
커리큘럼 삭제도 같은 포트(`LessonRecordingCleanup#deleteByLessons`)를 거치게 했다. 섹션 삭제는
레슨이 남아 있으면 애초에 거절하므로 녹화가 딸릴 수 없다.

즉 `NO ACTION`은 결함이 아니라 **의도된 게이트**다: "이 행을 지우려면 파일도 함께 책임져라."

## 그래서 규칙

새 열이 부모를 FK로 참조할 때 정한다:

| 그 행이 부모 없이 의미가 있나 | 밖에 딸린 자원이 있나 | 삭제 규칙 |
|---|---|---|
| 없다 | 없다 | `ON DELETE CASCADE` |
| 없다 | 있다(파일·외부 리소스) | `NO ACTION` + 정리 포트를 거치는 삭제 경로 |
| 있다 | — | `SET NULL` 또는 삭제 거절(명시적으로) |

**`ON DELETE`를 안 쓰는 것은 선택이 아니다.** 기본값 `NO ACTION`은 "생각하지 않았다"는 뜻이고,
그 결과가 이 ADR이다.

## 결과

- 라이브를 한 강의가 지워진다. 커리큘럼 삭제도 라이브 세션·녹화가 있어도 지워지고, 파일까지 정리된다.
- 계약 테스트가 **채팅이 있는 상태**를 재현한다. V21을 빼면 두 테스트가 정확히 그 두 제약으로 실패한다 —
  회귀를 잡는다는 뜻이다.
- 채팅은 강의와 함께 사라진다. 강의를 지우면 그 대화도 지운다는 뜻이고, 삭제 확인 문구가 이미
  "라이브 일정·자료·채팅이 함께 사라집니다"로 그렇게 안내하고 있다.

## 남은 것

화면은 삭제 실패 사유를 버리고 `강의를 삭제하지 못했습니다`만 띄운다(`LessonFormPage.tsx`). 이번 원인은
사라졌지만, 다음 실패도 똑같이 진단 불가능해진다. 서버가 준 메시지를 보여주는 편이 낫다 — 별도 건.
