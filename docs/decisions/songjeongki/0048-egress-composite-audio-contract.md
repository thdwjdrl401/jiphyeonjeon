# ADR-0048: Egress 합성 오디오 계약 — 합성 페이지가 소리를 내야 한다

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 판단 정책: [../../harness/POLICY.md](../../harness/POLICY.md)

- **상태**: 채택
- **일자**: 2026-07-30
- **관련**: Sub Ⅱ, ADR-0032(수강생은 HLS로만 시청), ADR-0034(Egress 완료 웹훅), ADR-0046(합성 캔버스·카메라 반전), 브랜치 `fix/fe-egress-audio-composition`

## 맥락 (Context)

라이브 HLS와 녹화가 **전부 무음**으로 나갔다. 화면은 정상이고 자막도 정상이었다.

자막이 나온다는 사실이 원인을 좁혀 준다. 자막은 STT 에이전트가 LiveKit 방에서 오디오 트랙을 직접
구독해 만든다. 즉 **강사 마이크 오디오는 LiveKit까지 정상 도착**한다. 퍼블리시·시그널링·SFU는 무죄고,
남은 곳은 합성 단계 한 곳이다.

`frontend/src/pages/EgressStagePage.tsx`(Egress 헤드리스 Chrome이 여는 합성 캔버스)가 원인이었다.

- 트랙 attach가 `if (!(track instanceof RemoteVideoTrack)) return`으로 시작해 **오디오 트랙을 전부
  버렸다**. 어디에도 attach되지 않으므로 재생되지 않는다.
- 두 `<video>`는 모두 `muted`였다.

결정적인 전제는 **Egress가 트랙을 직접 믹스하지 않는다**는 것이다. Egress는 헤드리스 Chrome의 화면을
캡처하듯 **오디오도 그 Chrome의 재생 출력을 pulseaudio 가상 싱크로 받아** 인코딩한다(egress 컨테이너에
pulseaudio 프로세스 확인). 그래서 **페이지가 스피커로 내보내지 않은 소리는 존재하지 않는다.** 여기에
ADR-0032가 겹친다 — 수강생은 LiveKit을 직접 구독하지 않고 이 합성 결과만 본다. 합성에서 빠진 오디오는
어느 경로로도 복구되지 않는다.

무음은 "화면이 안 나온다"와 달리 **조용히 실패한다.** 로그도 에러도 남지 않고, 로컬에서 소리로 검증할
수도 없다(Egress는 EC2에 배포된 프론트를 연다). 그래서 이 계약은 사람의 확인이 아니라 테스트로 잠가야
한다.

## 결정 (Decision)

1. **원격 오디오 트랙은 전용 `<audio>` element로 재생하고, 절대 음소거하지 않는다.**
   `track.attach()`(인자 없음)가 만들어 준 element를 화면 밖 싱크(`.egress-stage__audio`,
   `display: none`)에 붙인다.
2. **오디오는 소스를 화이트리스트로 걸지 않는다.** 원격 오디오 트랙이면 전부 합성에 싣는다. 강사
   마이크(`Microphone`)와 화면공유 오디오(`ScreenShareAudio`)가 지금의 두 소스다.
3. **`<video>`의 `muted`는 유지한다.** 소리와 그림의 자동재생 조건을 분리한다.
4. **자동재생 차단은 감지해 복구를 시도하고, 실패하면 콘솔에 남긴다.**
   `AudioPlaybackStatusChanged`로 차단을 감지하면 `room.startAudio()`를 상한(5회)까지 재시도하고,
   끝내 막히면 `console.error`로 원인을 확정적으로 찍는다.

## 근거 (Rationale)

- **오디오를 별도 element로 빼고 video의 muted는 남긴 이유.** `<video>`의 muted를 벗기는 쪽이 코드가
  짧지만 두 가지가 틀어진다. 첫째, LiveKit은 오디오를 **별도 트랙으로 퍼블리시**하므로 비디오
  element에는 애초에 소리가 실려 있지 않다 — muted를 벗겨도 소리는 나지 않는다. 둘째, muted 없는
  자동재생은 정책에 막힐 수 있고 그러면 **화면까지 멈춘다.** element를 분리하면 오디오가 막혀도 영상은
  계속 나간다. 사람이 보지 않는 페이지라 "실수로 소리가 난다"는 반대 방향의 위험은 없다.
- **화이트리스트를 쓰지 않는 이유.** 목록에서 빠진 소스는 곧 "들리지 않는 소리"이고, 그게 정확히 이
  버그였다(`RemoteVideoTrack`만 통과시킨 조건문). 소스를 좁히는 이득은 없고, 좁힐 때마다 같은 사고를
  다시 만든다. 화면공유 오디오는 강사가 탭 소리를 공유하면 수강생도 들어야 하므로 당연히 포함된다.
- **자동재생 전제와 그 방어.** Egress의 Chrome은 `--autoplay-policy=no-user-gesture-required`로
  뜨고(LiveKit 기본 템플릿도 제스처 없는 오디오 재생에 의존한다), `attach()`는 element에 `autoplay`를
  켜고 오디오 트랙이 있으면 `muted`를 해제한 뒤 `play()`까지 부른다. 그래서 정상 경로에서는 추가 조치가
  필요 없다. 그럼에도 복구 경로를 넣은 이유는 **이 실패 양식이 무음이기 때문**이다 — 플래그가 빠지거나
  정책이 바뀌면 아무 신호 없이 강의 전체가 조용해진다. `startAudio()`는 attach된 element의 음소거를
  풀고 AudioContext를 resume하므로 이 상황에 쓸 수 있는 유일한 수단이고, Egress가 이미 콘솔을
  감시하므로(`START_RECORDING`/`END_RECORDING`) `console.error`가 사후 진단의 실질적 창구다.
  무한 재시도는 Egress CPU를 갉아먹으니 상한을 둔다.
- **계약 테스트를 채택한 근거**([POLICY](../../harness/POLICY.md)). 라이브 전달은 CP 완료 게이트 핵심
  경로이고, 이 계약은 **Egress 헤드리스 Chrome ↔ 우리 페이지**라는 공유 경계에 걸린다("공유 경계를
  넘는가?" → 넘는다). 게다가 실동작 검증이 로컬에서 불가능하고 실패가 조용하다 — 자물쇠 없이는 다음
  리팩터가 같은 사고를 되풀이한다.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 |
|---|---|---|
| (선택) 오디오 전용 `<audio>` + video는 muted 유지 | 소리·그림의 자동재생 조건 분리, 트랙 수 제한 없음 | element를 직접 만들어 붙이므로 정리(detach·remove)를 우리가 해야 한다 |
| `<video>`의 muted만 제거 | 코드 최소 변경 | 비디오 트랙에 오디오가 없어 **소리가 나지 않는다**. 자동재생에 막히면 화면까지 멈춘다 — 채택 불가 |
| JSX에 `<audio>`를 미리 선언하고 ref로 attach | React가 생명주기를 관리 | 트랙 수가 고정이 아니다(마이크+화면공유+향후). 선언된 element에 `muted`가 섞여 들어갈 여지가 남는다 |
| `webAudioMix: true`로 WebAudio 그래프에서 믹스 | 볼륨·이펙트 제어 가능 | element를 의도적으로 muted로 두는 모드라 이 버그와 구분이 어려워진다. 합성에 필요 없는 CPU를 쓴다 |
| Egress가 트랙을 직접 믹스하게 설정 | 페이지 오디오와 무관해짐 | room_composite는 그런 모드가 없다. 페이지 캡처가 곧 오디오 소스다 |

## 영향·후속 (Consequences)

- **`EgressStagePage`는 "보이는 것"만이 아니라 "들리는 것"의 정본이다.** 파일 상단 주석과
  `egress-stage.css`의 `.egress-stage__audio` 주석에 이 계약을 명시했다. 이 페이지에서 오디오 element에
  `muted`를 거는 변경은 강의 전체를 무음으로 만드는 회귀다.
- **회귀 잠금**: `src/test/features/live-session/egressStageAudio.test.tsx`(14 케이스)가 (a) 마이크·
  화면공유 오디오가 각각·동시에 attach되는 것, (b) 그 element가 `muted`가 아니고 `autoplay`인 것,
  (c) 구독 해제 시 element가 걷히는 것, (d) 자동재생 차단 시 `startAudio()` 재시도와 상한·콘솔 기록,
  (e) `<video>`는 `muted`를 유지하고 화면공유·카메라 attach와 `is-stage` 전환이 그대로인 것을 검사한다.
  이 테스트는 수정 전 코드에서 오디오 케이스 9개가 실패하고 비디오 케이스는 통과하는 것으로 유효성을
  확인했다.
- **ADR-0046의 후속이 여전히 전제다.** `EGRESS_TEMPLATE_BASE_URL`이 비어 있으면 LiveKit 기본 템플릿이
  쓰이고 우리 페이지는 열리지 않는다. 그 경우 이 수정도 수강생 화면에 반영되지 않는다(기본 템플릿은
  오디오를 재생하므로 무음 증상 자체는 우리 템플릿이 쓰이고 있다는 방증이다).
- **실동작 미검증**: 소리가 실제로 HLS에 실리는지는 EC2 배포 후 확인해야 한다. 로컬 검증 범위는
  타입·린트·단위/계약 테스트·빌드까지다.
- 남은 위험은 볼륨·에코다. 강사 마이크와 화면공유 오디오가 동시에 나갈 때 상대 볼륨을 조절하지 않는다
  (각 element 기본 볼륨). 합성 페이지는 마이크를 퍼블리시하지 않아 자기 소리를 되받는 에코 경로는 없다.
  필요해지면 `RemoteAudioTrack.setVolume()`으로 소스별 조정을 검토한다.
