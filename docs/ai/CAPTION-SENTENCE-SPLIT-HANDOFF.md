# 라이브 자막 문장 단위 분할 인수 문서 — **구현됨**

> ✅ **구현 완료(2026-08-06).** 결정 기록은 [ADR-0086](../decisions/canola/0086-caption-line-is-a-sentence.md),
> 구현은 `ai/realtime-agent`의 `app/stt/sentence_boundary.py`·`app/stt/providers/segmented.py`·
> `app/captions/pipeline.py`다. 이 문서는 착수 전 작업 분해 기록으로 남긴다.
>
> **착수 후 바뀐 것 하나**: 증분 provider(Nemotron)의 문장 final은 아래 계획과 달리 **끝 시각을
> 나눠 갖지 못하고 세그먼트 끝 시각을 공유한다.** 그 provider의 delta가 이미 세그먼트 끝 시각을
> 소비했고 자막 stream 시각은 역행할 수 없기 때문이다(`app/captions/pipeline.py`가 `ValueError`로 막는다).
> 문장별로 달라지는 값은 시작 시각뿐이며, 이는 FE 시각 라벨·seek이 쓰는 축이라 목적은 달성된다.

> 📍 **자막 이벤트 규격의 정본은 [AI 계약 §4.6](CONTRACT.md#46-realtime-agentapplication-redis-자막)·
> [§10](CONTRACT.md#10-자막-세그먼트-경계-captionsegmentfinal시간-앵커-captionstreamstarted--부분-구현)이다.**
> 이 문서는 규격을 복제하지 않고 **작업 범위·삽입 지점·완료 조건만** 담는다(AGENTS.md §7 SSOT).
>
> 대상: `ai/realtime-agent` (GPU STT). **Spring·FE 변경 없음.**

## 문제

자막 한 줄의 단위가 문장이 아니라 **VAD 세그먼트**다. 세그먼트는 침묵 500ms 또는 15초 상한에서만
닫히므로(`app/audio/segmentation.py:136-142`, Nemotron은 `VadSegmenter()` 기본값 —
`app/stt/providers/segmented.py:68`), 강사가 문장 끝에서 쉬지 않으면 여러 문장이 한 줄로 붙는다.
FE는 `caption.segment.final` 하나당 한 줄을 렌더한다(`frontend/src/features/live-session/captionAdapter.ts:212-225`).

실제 관측된 자막(운영 Nemotron):

```
둘째는 입력 검증입니다. 제목이 비어있지는 않으니 허용한 길이를 넘지 않는지 예상한 형식인지
확인합니다. 잘못된 값은 업무처리를 시장하기 시작하기 전에 막아야 불필요한 저당 저장시도
```

## 목표

**한 문장 = 한 `caption.segment.final`.** 마침표에서 끊어 준다.

**이번 범위가 아닌 것** — 하지 말 것:

- VAD 파라미터 변경(문장 경계와 안 맞고 인식 품질을 해친다)
- Spring·FE 변경, wire 계약(`boundaryReason` 새 값) 변경
- Nemotron 스트리밍 중 문장 flush(지연 개선) — 후속
- Nemotron 반복·환각 게이트(ADR-0087은 Whisper 전용 경로다) — 별건

## 설계 원칙

**과소분할 우선.** 잘못 쪼개면 문장이 두 줄로 깨져 지금보다 나쁘고, 못 쪼개면 지금과 같다(무해).
애매하면 쪼개지 않는다.

## 변경 지점 4곳

### 1. 신규 `app/stt/sentence_boundary.py` — 순수 함수

`split_sentences(text: str) -> list[str]`

- 종결부호 `. ? !` 의 연속 run + 뒤따르는 닫는 문자(`" ' ’ ” ) ]`)까지 앞 문장에 포함시키고,
  그 다음이 **공백 또는 문자열 끝**일 때만 경계로 인정한다.
  (시급한 건 `.` 하나지만 `?`·`!`는 같은 문자 클래스라 추가 비용이 없다. 빼고 싶으면 한 글자 지우면 된다.)
- **쪼개지 않는 경우**
  - 앞뒤가 모두 숫자인 마침표(`3.14`, `1.2.3`)
  - 말줄임 `...`·`…` — 종결부호 집합에서 제외한다. Nemotron이 머뭇거림에 자주 쓴다
  - 경계 뒤에 남은 텍스트가 없을 때(세그먼트 마지막 마침표) — 조각을 만들지 않는다
- 각 조각은 `strip()`, 빈 조각 제거, 글자·숫자가 없는 조각은 앞 조각에 병합
- 종결부호가 없으면 `[text]` 하나를 그대로 반환한다(현행 동작 유지)

위치가 `app/stt/`인 이유: `app/captions/`가 이미 `app.stt.engine`을 import하므로
(`app/captions/pipeline.py:15`) 반대 방향은 순환 import가 된다.

### 2. `app/stt/engine.py` — 내부 `SegmentFinal`에 필드 추가

```python
text_already_delivered: bool = False   # 이 텍스트가 이미 delta로 나갔는가
```

**내부 엔진 이벤트라 wire 계약이 아니다**(wire는 `app/captions/models.py`의 `CaptionSegmentFinal`).
Spring·FE 영향 없음.

### 3. `app/captions/pipeline.py:136-137` — 중복 delta 방지

```python
if self._sequence <= self._last_final_sequence:
    await self._publish_normalized_delta(...)
```

이 자동 delta 보충은 "final 하나당 delta가 딸려 있다"를 가정한다. final이 N개가 되면 **2번째 문장부터
이 분기에 걸려 이미 나간 텍스트를 delta로 다시 발행한다.** FE는 멀쩡히 보이지만 ai-api RAG 컨텍스트가
delta를 구분자 없이 잇기 때문에(`ai/ai-api/app/captions/store.py:216`) **같은 문장이 두 번 들어간다.**

→ `event.text_already_delivered`가 True면 이 분기를 건너뛴다.

### 4. `app/stt/providers/segmented.py:203-218` — 분할 지점

두 경로를 나눠 처리한다.

| | Nemotron(증분, `emitted_parts` 있음) | Whisper(`ProviderSegmentFinal`) |
|---|---|---|
| delta | **손대지 않는다** — 토큰 조각 그대로 | 문장마다 `TextDelta(문장)` |
| final | 문장마다 `SegmentFinal(..., text_already_delivered=True)` | 문장마다 `SegmentFinal(..., text_already_delivered=False)` |

Nemotron의 delta를 안 건드리는 게 중요하다. 그래야 RAG 컨텍스트가 지금과 바이트 단위로 같아
회귀 위험이 없다.

**문장별 시각**: `[item.start_ms, item.end_ms]`를 문자 수 비례로 배분한다.

- 문장 i의 `start` = 문장 i-1의 `end`(첫 문장은 `item.start_ms`)
- 마지막 문장의 `end`는 `item.end_ms`와 정확히 일치시킨다
- 단조 증가 필수 — `app/captions/pipeline.py:96,127`이 시각 역행에 `ValueError`를 던진다
- 이 시각은 FE에서 시각 라벨과 seek 목표로만 쓰인다(세그먼트는 항상 `synced: false` —
  `captionAdapter.ts:220`). 노출 게이팅에 안 쓰이므로 보간 오차는 치명적이지 않다

**`boundaryReason`에 새 값을 넣지 말 것**: `SILENCE | MAX_DURATION | STREAM_END` 셋만 허용되고
(`app/captions/models.py:132`), Spring `CaptionEventParser.java:34,162`가 그 외 값이면
`CaptionParseException`으로 이벤트를 통째로 버린다 — 자막이 화면에서 사라진다.

→ **중간 문장은 `SILENCE`, 마지막 문장만 세그먼트의 원래 reason.** `MAX_DURATION` 집계가
세그먼트당 1건으로 유지된다.

## 테스트 (계약 걸림 — 계약 §10 표시 계약)

`tests/test_sentence_boundary.py` (신규)

- 마침표·물음표·느낌표 분할, 닫는 따옴표/괄호 포함
- `3.14`·`1.2.3` 미분할, 말줄임 미분할
- 종결부호 없음 → 1개 반환
- 부호만 있는 조각 병합, 앞뒤 공백 제거

`tests/test_nemotron_provider.py`·`tests/test_segmented_provider_lifecycle.py` (확장)

- 증분 fake provider: **delta는 변경 전과 동일**, final N개, `text_already_delivered=True`
- authoritative fake provider: delta N개 + final N개 쌍
- 시각 단조 증가, 마지막 문장 `end == item.end_ms`, `segment_index` 연속
- 회귀: 종결부호 없는 텍스트는 이벤트 시퀀스가 변경 전과 완전히 동일

`tests/test_caption_pipeline.py` (확장)

- `text_already_delivered=True`인 연속 final에서 중복 delta가 발행되지 않는다
- `boundaryReason`이 중간 `SILENCE` / 마지막 원래 값

## 완료 게이트 (AGENTS.md §4)

- 브랜치 `feat/ai/caption-sentence-boundary`
- ADR에 결정 3개 기록: 분할 규칙(과소분할 우선) · `boundaryReason` 매핑 · 시각 보간.
  번호는 **`master`와 열린 MR을 함께 확인하고** 집는다(canola는 master 기준 0083까지, 로컬 0085 존재,
  0084는 다른 브랜치로 보인다). `bash scripts/check-version-collisions.sh`
- 위 계약 테스트 통과 로그 첨부. `TODO`·빈 스텁 금지

## 후속 (별도 MR, 이번 범위 아님)

- **Nemotron 스트리밍 flush**: `TextIteratorStreamer`가 토큰을 실시간으로 내주므로
  (`app/stt/nemotron_asr.py:167-177`) 문장 완성 즉시 final을 끊으면 지연이 준다(지금은 15초 세그먼트면
  첫 문장도 15초 뒤 확정). 단, 현재 모든 delta가 `item.end_ms` 하나를 공유하므로
  (`segmented.py:202`) `transcribe_stream`이 `(text, audio_offset_ms)`를 내주도록 바꾸는 작업과
  한 묶음이어야 한다. 안 그러면 시각이 거짓이 된다
- **ai-api delta join 공백**: `ai/ai-api/app/captions/store.py:216`이 구분자 없이 잇고
  `app/captions/text_normalizer.py:37-40`이 delta 첫머리 공백을 버려 `확인합니다.잘못된`이 된다.
  Whisper 경로에만 영향(Nemotron은 delta를 안 건드리므로 무관)
- **wire `boundaryReason`에 `SENTENCE` 추가**: 계약 §10에 요청을 올리고 Spring 배포가 먼저 나가야 한다
