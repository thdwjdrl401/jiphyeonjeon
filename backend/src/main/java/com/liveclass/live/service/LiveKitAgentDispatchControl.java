package com.liveclass.live.service;

import com.liveclass.live.api.LiveKitServerAccess;
import io.livekit.server.AgentDispatchServiceClient;
import livekit.LivekitAgentDispatch;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import retrofit2.Response;

import java.util.List;
import java.util.Optional;

/**
 * AgentDispatchControl 구현 — LiveKit AgentDispatchService(HTTP/TwirP)를 호출한다.
 * 접속 정보는 {@link LiveKitServerAccess}로 주입받아 {@link LiveKitRoomControl}·{@code LiveKitEgressControl}과 같은 패턴이다.
 */
@Service
public class LiveKitAgentDispatchControl implements AgentDispatchControl {

    private static final Logger log = LoggerFactory.getLogger(LiveKitAgentDispatchControl.class);

    private final AgentDispatchServiceClient client;

    public LiveKitAgentDispatchControl(LiveKitServerAccess access) {
        this.client = AgentDispatchServiceClient.createClient(access.apiUrl(), access.apiKey(), access.apiSecret());
    }

    @Override
    public Optional<String> ensureDispatch(String room, String agentName, String metadataJson) {
        try {
            Optional<String> existing = findExisting(room, agentName, metadataJson);
            if (existing.isPresent()) {
                log.info("기존 AgentDispatch 재사용 room={} dispatchId={}", room, existing.get());
                return existing;
            }
            Response<LivekitAgentDispatch.AgentDispatch> res =
                    client.createDispatch(room, agentName, metadataJson).execute();
            if (!res.isSuccessful() || res.body() == null) {
                log.warn("AgentDispatch 생성 실패 room={} agent={} : HTTP {}", room, agentName, res.code());
                return Optional.empty();
            }
            String dispatchId = res.body().getId();
            log.info("AgentDispatch 생성 room={} agent={} dispatchId={}", room, agentName, dispatchId);
            return Optional.of(dispatchId);
        } catch (Exception e) {
            // assume-ready는 job readiness만 우회한다. Optional.empty는 오케스트레이터가 시작 실패로 접는다.
            log.warn("AgentDispatch 준비 실패 room={} agent={} : {}", room, agentName, e.getMessage());
            return Optional.empty();
        }
    }

    @Override
    public void deleteDispatch(String room, String dispatchId) {
        try {
            Response<?> response = client.deleteDispatch(room, dispatchId).execute();
            if (!response.isSuccessful() && response.code() != 404) {
                throw new IllegalStateException("HTTP " + response.code());
            }
            log.info("AgentDispatch 삭제 room={} dispatchId={}", room, dispatchId);
        } catch (Exception e) {
            log.warn("AgentDispatch 삭제 실패(무시) room={} dispatchId={}: {}", room, dispatchId, e.getMessage());
        }
    }

    /** 같은 agent·같은 metadata 문자열이면 이번 시작이 원하는 것과 동일한 예약이라 재사용한다. */
    private Optional<String> findExisting(String room, String agentName, String metadataJson) throws Exception {
        Response<List<LivekitAgentDispatch.AgentDispatch>> res = client.listDispatch(room).execute();
        if (!res.isSuccessful() || res.body() == null) {
            throw new IllegalStateException("AgentDispatch 목록 조회 실패: HTTP " + res.code());
        }
        return res.body().stream()
                .filter(d -> agentName.equals(d.getAgentName()) && metadataJson.equals(d.getMetadata()))
                .map(LivekitAgentDispatch.AgentDispatch::getId)
                .findFirst();
    }
}
