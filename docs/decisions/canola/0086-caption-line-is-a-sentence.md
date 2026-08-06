# ADR-0086: 자막 한 줄의 단위는 VAD segment가 아니라 문장이다

- **상태**: 채택
- **일자**: 2026-08-06
- **관련**: [ADR-0082](0082-realtime-caption-display-text-normalization.md),
  [ADR-0085](0085-whisper-silence-and-repetition-guard.md),
  [ADR-0043](../songjeongki/0043-caption-consumer-persistence.md),
  [ADR-0052](../songjeongki/0052-caption-segment-anchor-consumption.md),
  [ADR-0053](../songjeongki/0053-caption-segment-delivery-and-render.md)

## 맥락

소비 측은 `caption.segment.final` 하나를 자막 한 줄로 렌더한다. 그런데 producer가 final을 만드는
단위는 VAD segment이며, segment는 무음 500ms 또는 15초 상한에서만 닫힌다 — **의미가 아니라 침묵으로
끊는다.** 강사가 문장 끝에서 쉬지 않으면 여러 문장이 한 줄이 된다. 운영 Nemotron 실강의에서 관측된
자막이 그 예다.

```text
둘째는 입력 검증입니다. 제목이 비어있지는 않으니 허용한 길이를 넘지 않는지 예상한 형식인지
확인합니다. 잘못된 값은 업무처리를 시작하기 전에 막아야 …
```

VAD를 더 짧게 잡는 방법은 채택하지 않았다. 사람은 문장 끝에서 쉬지 않으므로 무음 경계와 문장 경계는
애초에 다르고, segment가 짧아지면 provider가 보는 문맥이 줄어 ADR-0085가 억제한 환각·반복 위험이
되돌아온다. 소비 측 문장부호 휴리스틱도 채택하지 않았다 — ADR-0053이 그 휴리스틱을 걷어내고 경계를
producer가 권위 있게 준다는 합의다.

`boundaryReason`은 `SILENCE|MAX_DURATION|STREAM_END` 세 값만 허용되고 Spring parser가 그 외 값을
`CaptionParseException`으로 거부한다. 새 값 `SENTENCE`를 producer가 먼저 내보내면 자막 이벤트가
통째로 버려진다.

## 결정

1. 한 VAD segment의 확정 text를 문장으로 나눠 **문장마다 `SegmentFinal`을 하나씩** 발행한다. 분할은
   provider adapter가 아니라 공통 `SegmentedStreamingEngine`이 수행한다.
2. 분할 규칙은 **과소분할 우선**이다. 경계는 종결부호 `.`·`?`·`!` 한 글자 뒤에 공백이나 문자열 끝이
   올 때만 인정한다. 연속 종결부호(`...`, `?!`), `…`, 숫자 사이 마침표(`3.14`), 뒤 단어에 붙은
   마침표(`worker.py`), text 끝의 마지막 종결부호는 경계가 아니다. 종결부호가 없으면 나누지 않고
   기존과 같은 한 줄을 유지한다.
3. `boundaryReason`은 기존 세 값만 쓴다. **segment를 끝낸 마지막 문장만 그 segment의 원래 사유**를
   갖고 앞의 문장들은 `SILENCE`를 보고한다. `MAX_DURATION` 집계는 segment당 한 건으로 유지된다.
   wire에 `SENTENCE`를 추가하는 일은 Spring 배포가 선행돼야 하므로 이 결정에 포함하지 않는다.
4. 문장별 시각은 segment 구간 `[start, end]`을 문장 길이에 비례해 나눈 **추정치**다. 마지막 문장의
   끝은 segment의 끝과 정확히 일치시킨다.
5. 증분 delta를 내는 provider(Nemotron)의 문장 final은 **모두 segment 끝 시각에서 끝난다.** 그 provider의
   delta가 이미 segment 끝 시각을 소비했고 자막 stream 시각은 역행할 수 없기 때문이다. 이 경우 문장별로
   달라지는 값은 시작 시각뿐이다.
6. 내부 `SegmentFinal`에 `text_already_delivered`를 둔다. 증분 provider의 문장 final은 이미 delta로
   나간 text이므로 caption mapper가 delta를 다시 만들지 않는다. delta를 내지 않는
   provider(vLLM Whisper)에서는 문장마다 delta와 final을 한 쌍으로 발행한다.
7. Redis event schema, `boundaryReason` 허용값, Spring consumer와 FE 렌더 코드는 바꾸지 않는다.

## 영향

- 자막 한 줄이 한 문장이 된다. `segmentIndex`와 `core.live_caption` 행 수는 segment당 문장 수만큼
  늘어난다(대략 2배). Redis stream `MAXLEN` 소진 속도도 같은 비율로 빨라진다.
- **delta stream은 provider별로 다르게 유지된다.** 증분 provider의 delta는 한 byte도 바뀌지 않으므로
  ai-api RAG caption context는 회귀가 없다. Whisper 경로만 segment당 delta가 문장 수만큼 늘어난다.
- 문장 시작 시각이 추정치이므로 자막 클릭 seek과 시각 라벨이 segment 안에서 최대 수백 ms 어긋날 수
  있다. 노출 게이팅에는 쓰이지 않는 축이라(FE는 이 좌표를 `synced=false`로 다룬다) 표시 정확도만
  영향을 받는다. ADR-0052의 다시보기 자막도 같은 추정 좌표를 쓰게 된다.
- 증분 provider에서는 한 segment의 문장들이 같은 끝 시각을 공유한다. 문장별 실제 끝 시각은 provider가
  각 chunk가 어느 오디오에서 나왔는지 함께 보고해야 얻을 수 있고, 그때 이 제약과 5번 결정이 사라진다.
- 확정 지연은 그대로다. 문장들은 여전히 segment가 닫힌 뒤 한꺼번에 나간다. Nemotron은 디코딩 중에
  문장을 끊을 수 있으나 위 시각 문제 때문에 후속 슬라이스로 미룬다.
- 종결부호를 내지 않는 발화 구간은 지금과 똑같이 한 줄로 남는다.

## 검증

- 분할 규칙 단위 테스트: 종결부호 분할, 소수점·버전·말줄임·연속 종결부호·붙은 마침표 미분할,
  종결부호 없는 text 무변경, 단어 없는 조각 흡수.
- engine 단위 테스트: 증분 provider의 delta 무변경 + 문장별 final, 비증분 provider의 문장별 delta·final
  쌍, 시각 단조 증가와 마지막 문장의 끝 일치, 중간 문장 `SILENCE`·마지막 문장 원래 사유.
- caption mapper 단위 테스트: `text_already_delivered` final이 delta를 중복 발행하지 않는 것과,
  살아남은 delta가 없을 때는 `lastSequence`가 0이 되지 않도록 delta를 그대로 만드는 것.
- 실제 강의 샘플로 Redis E2E를 재검증한다.
