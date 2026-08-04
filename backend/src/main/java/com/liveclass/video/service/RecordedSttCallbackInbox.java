package com.liveclass.video.service;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.sql.Timestamp;
import java.time.OffsetDateTime;

@Component
public class RecordedSttCallbackInbox {
    private static final String SOURCE = "recorded-stt-worker";
    private final JdbcTemplate jdbcTemplate;

    public RecordedSttCallbackInbox(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public boolean tryReceive(String eventId, String eventType, String aggregateRef, String rawJson) {
        OffsetDateTime now = OffsetDateTime.now();
        return jdbcTemplate.update("""
                INSERT INTO core.external_event_inbox
                  (source, source_event_id, event_type, aggregate_ref, payload_json, status,
                   received_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, CAST(? AS jsonb), 'RECEIVED', ?, ?, ?)
                ON CONFLICT (source, source_event_id) DO NOTHING
                """, SOURCE, eventId, eventType, aggregateRef, rawJson,
                Timestamp.from(now.toInstant()), Timestamp.from(now.toInstant()), Timestamp.from(now.toInstant())) == 1;
    }

    public void markProcessed(String eventId) {
        OffsetDateTime now = OffsetDateTime.now();
        jdbcTemplate.update("""
                UPDATE core.external_event_inbox
                SET status = 'PROCESSED', processed_at = ?, updated_at = ?
                WHERE source = ? AND source_event_id = ?
                """, Timestamp.from(now.toInstant()), Timestamp.from(now.toInstant()), SOURCE, eventId);
    }
}
