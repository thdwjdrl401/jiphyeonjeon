# STT 테스트용 지속 퍼블리셔 래퍼.
# livekit-cli 이미지엔 셸이 없어 timeout 루프를 못 돌리므로,
# lk 바이너리만 가져와 셸 있는 베이스(debian-slim)에 얹는다.
FROM livekit/livekit-cli AS cli

FROM debian:stable-slim
COPY --from=cli /lk /usr/local/bin/lk
COPY publish-loop.sh /usr/local/bin/publish-loop.sh
RUN chmod +x /usr/local/bin/publish-loop.sh
ENTRYPOINT ["/usr/local/bin/publish-loop.sh"]
