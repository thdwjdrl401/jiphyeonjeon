package com.liveclass.notification.push;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementSetter;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;

import java.sql.Array;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 진행 기록이 명단을 조각으로 잘라 넣을 때 <b>아무도 새지 않는가</b>(ADR-0137).
 *
 * <p>사람마다 문장 하나였던 것을 배열 한 번으로 바꾸면서 자르는 코드가 생겼다. 여기서 한 명이라도
 * 빠지면 그 사람은 "시도를 마쳤다"로 안 적히고, 재배달이 그를 다시 집어 <b>한 번 더 울린다.</b>
 * 실패가 조용해서(로그도 오류도 없다) 경계는 테스트로 잡는다.
 *
 * <p>전체를 한 문장으로 하지 않은 이유도 여기 있다 — 자르면 앞쪽 조각이 커밋돼 있어 크래시 때
 * 다시 갈 사람이 적다. 그 성질을 지키려면 자르는 것이 맞아야 한다.
 */
class PushProgressSettleChunkTest {

    private static final int CHUNK = 1_000;

    private JdbcTemplate jdbcTemplate;
    private PushDeliveryProgressRepository repository;
    /** 문장마다 실제로 넘어간 명단. 순서대로 쌓인다. */
    private List<List<UUID>> written;

    @BeforeEach
    void setUp() throws Exception {
        jdbcTemplate = mock(JdbcTemplate.class);
        NamedParameterJdbcTemplate named = mock(NamedParameterJdbcTemplate.class);
        when(named.getJdbcTemplate()).thenReturn(jdbcTemplate);
        repository = new PushDeliveryProgressRepository(named);
        written = new ArrayList<>();

        when(jdbcTemplate.update(anyString(), any(PreparedStatementSetter.class))).thenAnswer(call -> {
            PreparedStatement statement = mock(PreparedStatement.class);
            Connection connection = mock(Connection.class);
            when(statement.getConnection()).thenReturn(connection);
            when(connection.createArrayOf(eq("uuid"), any(Object[].class))).thenAnswer(made -> {
                Object[] elements = made.getArgument(1);
                written.add(java.util.Arrays.stream(elements).map(UUID.class::cast).toList());
                return mock(Array.class);
            });
            call.<PreparedStatementSetter>getArgument(1).setValues(statement);
            return 0;
        });
    }

    private static List<UUID> people(int count) {
        List<UUID> ids = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            ids.add(UUID.randomUUID());
        }
        return ids;
    }

    private List<UUID> flattened() {
        return written.stream().flatMap(List::stream).toList();
    }

    /** 조각 크기의 배수가 아닌 명단 — 마지막 조각이 잘리는 자리다. */
    @Test
    @DisplayName("조각으로 나눠도 명단 전원이 정확히 한 번씩 적힌다")
    void every_recipient_is_written_exactly_once() {
        List<UUID> recipients = people(2_500);

        repository.settle(UUID.randomUUID(), recipients);

        assertThat(written).as("1,000 + 1,000 + 500").hasSize(3);
        assertThat(written.get(0)).hasSize(CHUNK);
        assertThat(written.get(1)).hasSize(CHUNK);
        assertThat(written.get(2)).hasSize(500);
        assertThat(flattened())
                .as("빠진 사람도 두 번 적힌 사람도 없다")
                .containsExactlyElementsOf(recipients);
        assertThat(new LinkedHashSet<>(flattened())).hasSize(recipients.size());
    }

    /** 딱 떨어지면 빈 문장이 하나 더 나가면 안 된다. */
    @Test
    @DisplayName("조각 크기와 정확히 같으면 문장이 하나다")
    void an_exact_multiple_does_not_emit_an_empty_chunk() {
        List<UUID> recipients = people(CHUNK);

        repository.settle(UUID.randomUUID(), recipients);

        assertThat(written).hasSize(1);
        assertThat(flattened()).containsExactlyElementsOf(recipients);
    }

    @Test
    @DisplayName("한 명이어도 그 한 명이 적힌다")
    void a_single_recipient_still_gets_written() {
        List<UUID> recipients = people(1);

        repository.settle(UUID.randomUUID(), recipients);

        assertThat(written).hasSize(1);
        assertThat(flattened()).containsExactlyElementsOf(recipients);
    }

    /** 보낸 사람이 없으면 DB를 건드리지 않는다. */
    @Test
    @DisplayName("빈 명단이면 문장을 보내지 않는다")
    void an_empty_roster_touches_nothing() {
        repository.settle(UUID.randomUUID(), Set.of());

        verify(jdbcTemplate, never()).update(anyString(), any(PreparedStatementSetter.class));
    }
}
