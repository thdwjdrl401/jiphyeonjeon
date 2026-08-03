# ai-api scripts

## 강의 노트 prompt A/B

고정된 한국어 8개 case로 기존 v1과 production v2를 같은 GMS 모델에서 비교한다.

```bash
uv run --frozen --env-file ../.env python -m scripts.evaluate_lecture_note_prompts
```

자동 점수는 유효 JSON, 기대 action 일치, 현재 topic이 있는데 불필요하게 `START_NEW`한 횟수, 유효 내용을
`IGNORE`한 횟수만 센다. 첫 topic의 `APPEND`와 `START_NEW`는 reducer 결과가 같으므로 동등하게 본다.
요점의 근거성·문장 품질은 출력된 case별 결과를 사람이 함께 확인한다.

2026-07-30 현재 `.env`의 GMS 모델로 실행한 결과다.

| 항목 | v1 | v2 |
|---|---:|---:|
| 유효 응답 | 7/8 | 8/8 |
| 실질 action 일치 | 5/8 | 8/8 |
| 실제 topic 과분할 | 0 | 0 |
| 유효 내용 `IGNORE` | 0 | 0 |

v2는 반복, 미완성 발화, 운영 안내를 모두 `IGNORE`했고 현재 topic의 예시·주의사항은 `APPEND`했다. 실제
topic 과분할이 확인되지 않았으므로 한-window topic 전환 확인은 추가하지 않는다.

종료 후 refinement JSON 호환성은 고정된 구조화 draft로 한 번 확인한다.

```bash
uv run --frozen --env-file ../.env python -m scripts.smoke_lecture_note_refinement
```

2026-07-30 실제 GMS 호출에서 두 ACK topic을 하나로 합친 유효 `topics` JSON 응답을 확인했다.

## 활성 topic 갱신 A/B

약 2,000자의 같은 강의문을 7개 window로 나눠 현재 bullet append 방식과 역할 기반 활성 topic 갱신
prototype에 순서대로 입력한다. 활성 topic은 `overview`와 typed items를 명사형 서술로 생성하며 Pydantic
structured output으로 검증한다. 기본 설정은 `ai/.env`에서 읽는다.

```bash
uv run --frozen python -m scripts.compare_active_topic_notes
```

한쪽 pipeline만 다시 실행할 때는 `--pipeline v1` 또는 `--pipeline v2`를 사용한다.

입력은 `lecture_note_active_topic_sample.json`이며 실제 결과와 후속 판단은
[ADR-0034](../../../docs/decisions/canola/0034-near-realtime-accumulative-lecture-notes.md)에 기록한다.
