package com.liveclass.video;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

/** 최신 master의 V30과 과거 dev DB의 녹화강의 V23 흔적을 함께 승계하는 순서를 고정한다. */
class RecordedMigrationCompatibilityTest {

    @Test
    void recorded_migrations_follow_master_v30_in_dependency_order() {
        assertThat(resource("V30__annotation_highlight_describe_retry.sql").exists()).isTrue();
        assertThat(resource("V31__recorded_lesson_upload.sql").exists()).isTrue();
        assertThat(resource("V32__material_key_term_status.sql").exists()).isTrue();
        assertThat(resource("V33__recorded_lesson_stt.sql").exists()).isTrue();
        assertThat(resource("V34__recorded_delivery_auto_publication.sql").exists()).isTrue();
    }

    @Test
    void upload_migration_adopts_the_legacy_recorded_schema_without_duplicate_objects() throws IOException {
        String sql = resource("V31__recorded_lesson_upload.sql")
                .getContentAsString(StandardCharsets.UTF_8);

        assertThat(sql)
                .contains("ADD COLUMN IF NOT EXISTS delivery_type")
                .contains("CREATE TABLE IF NOT EXISTS core.recorded_video")
                .contains("CREATE TABLE IF NOT EXISTS core.media_transcode_job")
                .contains("DROP TRIGGER IF EXISTS trg_lesson_delivery_type_immutable")
                .contains("DROP TRIGGER IF EXISTS trg_recorded_video_lesson_type")
                .contains("DROP TRIGGER IF EXISTS trg_live_session_lesson_type");
    }

    private ClassPathResource resource(String fileName) {
        return new ClassPathResource("db/migration/" + fileName);
    }
}
