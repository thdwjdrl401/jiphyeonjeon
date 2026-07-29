package com.liveclass.live.api;

/**
 * GPU realtime-agent의 서비스 수준 liveness/readiness를 조회하는 포트.
 *
 * <p>이 readiness는 배포 전 warm pool과 LiveKit 연결 상태를 확인한다. 특정 dispatch job의 model,
 * Redis, room audio 준비를 증명하지 않으므로 라이브 시작의 job-level STT_READY gate를 대체하지 않는다.
 */
public interface RealtimeAgentHealth {

    Liveness liveness();

    Readiness readiness();

    record Liveness(String contractVersion, String status, String service) {
    }

    record Readiness(
            String contractVersion,
            String status,
            String service,
            String sttProvider,
            boolean workerStarted,
            boolean liveKitConnected,
            boolean modelsReady,
            int readyProcessCount,
            int expectedProcessCount) {

        public boolean ready() {
            return "ready".equals(status)
                    && workerStarted
                    && liveKitConnected
                    && modelsReady
                    && readyProcessCount >= expectedProcessCount;
        }
    }
}
