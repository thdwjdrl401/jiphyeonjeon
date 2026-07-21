#!/bin/sh
# 지속 퍼블리셔: 재생목록(playlist)의 클립들을 순서대로 방에 흘려보내고, 끝나면 처음부터 반복한다.
# 각 클립 = "영상(.h264)|음성(.ogg)|길이초". lk는 파일이 끝나도 종료되지 않고 idle 하므로,
# timeout으로 파일 길이만큼 돌린 뒤 다음 클립으로 넘어가 루프를 만든다.
# STT 서버는 이 방(av-bot 참가자)의 audio 트랙만 구독하면 된다.
#
# ▶ 재생 대상 바꾸는 법: docker-compose.yml 의 STT_PLAYLIST 환경변수만 고치면 된다 (공백으로 클립 구분).
#     imf만            : "/audio/imf-video.h264|/audio/imf-audio.ogg|68"
#     imf ↔ springBoot : "/audio/imf-video.h264|/audio/imf-audio.ogg|68 /audio/loop-video.h264|/audio/loop-audio.ogg|2665"
#   길이초는 각 소스 파일 길이에 맞춘다(imf=68s, springBoot=2665s). 바꾼 뒤 av-bot 재시작.
set -u

URL="${LIVEKIT_URL:-ws://localhost:7880}"
ROOM="${STT_ROOM:-stt-test}"
IDENTITY="${STT_IDENTITY:-av-bot}"
FPS="${STT_FPS:-15}"
# 기본 재생목록: imf만(완전 대체). compose에서 STT_PLAYLIST로 덮어써 번갈아 모드로 전환 가능.
PLAYLIST="${STT_PLAYLIST:-/audio/imf-video.h264|/audio/imf-audio.ogg|68}"

echo "[stt-bot] start: room=$ROOM identity=$IDENTITY url=$URL fps=$FPS"
echo "[stt-bot] playlist: $PLAYLIST"
while true; do
  for clip in $PLAYLIST; do
    VIDEO=$(echo "$clip" | cut -d'|' -f1)
    AUDIO=$(echo "$clip" | cut -d'|' -f2)
    DUR=$(echo "$clip" | cut -d'|' -f3)
    echo "[stt-bot] $(date -u +%H:%M:%S) publish $VIDEO + $AUDIO (loop ${DUR}s)"
    timeout "${DUR}" lk room join --url "$URL" \
      --api-key "${LIVEKIT_API_KEY}" --api-secret "${LIVEKIT_API_SECRET}" \
      --room "$ROOM" --identity "$IDENTITY" \
      --publish "$VIDEO" --publish "$AUDIO" --fps "$FPS" || true
    echo "[stt-bot] clip end → next in 1s"
    sleep 1
  done
done
