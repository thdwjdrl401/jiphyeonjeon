package com.liveclass.aiintegration.api;

import java.io.IOException;
import java.util.function.Consumer;

/**
 * 열려 있는 ai-api SSE 업스트림. {@link #forEachEvent}가 프레임을 오는 대로(버퍼링 없이) 넘긴다.
 *
 * <p>{@link #close()}는 업스트림 연결을 끊는다 — 브라우저가 취소하면 반드시 닫아 백프레셔가 위로
 * 전파되게 한다(닫지 않으면 ai-api의 process-local active request 슬롯이 계속 잡혀 503을 부른다).
 */
public interface RagAnswerStreamHandle extends AutoCloseable {

    /**
     * 스트림이 끝날 때까지 프레임을 하나씩 소비자에게 넘긴다(블로킹). 소비자가 던진 런타임 예외는
     * 그대로 전파된다 — 브라우저 쓰기 실패를 취소 신호로 쓰기 위함이다.
     *
     * @throws IOException 업스트림 읽기 실패(중간 끊김 포함)
     */
    void forEachEvent(Consumer<RagSseEvent> consumer) throws IOException;

    @Override
    void close();
}
