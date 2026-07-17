#!/bin/sh
# 지속 퍼블리셔: 영상(H.264) + 음성(Opus) 파일을 방에 계속 흘려보낸다.
# lk는 파일이 끝나도 종료되지 않고 idle 하므로, timeout으로 파일 길이만큼 돌린 뒤
# 재시작하여 루프를 만든다. STT 서버는 이 방(av-bot 참가자)의 audio 트랙만 구독하면 된다.
set -u

URL="${LIVEKIT_URL:-ws://localhost:7880}"
ROOM="${STT_ROOM:-stt-test}"
IDENTITY="${STT_IDENTITY:-av-bot}"
DUR="${LOOP_SECONDS:-2665}"          # 파일 길이(초)에 맞춤 → 이 시간 뒤 재시작
VIDEO="${STT_VIDEO:-/audio/loop-video.h264}"
AUDIO="${STT_AUDIO:-/audio/loop-audio.ogg}"
FPS="${STT_FPS:-15}"

echo "[stt-bot] start: room=$ROOM identity=$IDENTITY url=$URL loop=${DUR}s"
while true; do
  echo "[stt-bot] $(date -u +%H:%M:%S) publish video+audio (loop ${DUR}s)"
  timeout "${DUR}" lk room join --url "$URL" \
    --api-key "${LIVEKIT_API_KEY}" --api-secret "${LIVEKIT_API_SECRET}" \
    --room "$ROOM" --identity "$IDENTITY" \
    --publish "$VIDEO" --publish "$AUDIO" --fps "$FPS" || true
  echo "[stt-bot] loop end → restart in 1s"
  sleep 1
done
