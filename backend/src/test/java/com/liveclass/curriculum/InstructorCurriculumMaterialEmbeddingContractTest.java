package com.liveclass.curriculum;

import com.liveclass.aiintegration.api.OutboxPublisher;
import com.liveclass.asset.api.AssetDirectory;
import com.liveclass.curriculum.domain.Curriculum;
import com.liveclass.curriculum.domain.Section;
import com.liveclass.curriculum.repository.CurriculumRepository;
import com.liveclass.curriculum.repository.SectionRepository;
import com.liveclass.curriculum.service.InstructorCurriculumService;
import com.liveclass.lesson.api.CurriculumMaterialManagement;
import com.liveclass.lesson.api.LessonDirectory;
import com.liveclass.lesson.api.LessonManagement;
import com.liveclass.lesson.api.LessonMaterialManagement;
import com.liveclass.lesson.api.LessonView;
import com.liveclass.lesson.api.MaterialView;
import com.liveclass.live.api.LiveSessionDirectory;
import com.liveclass.live.api.LiveSessionManagement;
import com.liveclass.video.api.LessonRecordingCleanup;
import com.liveclass.video.api.RecordedVideoManagement;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** ADR-0010의 Spring → worker v2 작업 envelope와 초기 상태를 고정한다. */
class InstructorCurriculumMaterialEmbeddingContractTest {

    @Test
    void lesson_material_attach_publishes_v2_embedding_and_key_term_job() {
        UUID instructorId = UUID.randomUUID();
        UUID curriculumId = UUID.randomUUID();
        UUID sectionId = UUID.randomUUID();
        UUID lessonId = UUID.randomUUID();
        UUID assetId = UUID.randomUUID();
        UUID materialId = UUID.randomUUID();

        CurriculumRepository curriculumRepository = mock(CurriculumRepository.class);
        SectionRepository sectionRepository = mock(SectionRepository.class);
        LessonManagement lessonManagement = mock(LessonManagement.class);
        LessonMaterialManagement lessonMaterials = mock(LessonMaterialManagement.class);
        OutboxPublisher outbox = mock(OutboxPublisher.class);

        Curriculum curriculum = new Curriculum();
        curriculum.setId(curriculumId);
        curriculum.setInstructorId(instructorId);
        Section section = new Section();
        section.setId(sectionId);
        section.setCurriculumId(curriculumId);
        LessonView lesson = new LessonView(
                lessonId, sectionId, "녹화강의", "설명", 1, "PUBLISHED", "RECORDED", null, null);
        MaterialView attached = new MaterialView(
                materialId, assetId, "deck.pptx", 1024L, "ACTIVE", "READY", "NOT_REQUESTED");

        when(lessonManagement.findById(lessonId)).thenReturn(Optional.of(lesson));
        when(sectionRepository.findById(sectionId)).thenReturn(Optional.of(section));
        when(curriculumRepository.findById(curriculumId)).thenReturn(Optional.of(curriculum));
        when(lessonMaterials.attach(lessonId, assetId, instructorId)).thenReturn(attached);

        InstructorCurriculumService service = new InstructorCurriculumService(
                curriculumRepository,
                sectionRepository,
                mock(LessonDirectory.class),
                lessonManagement,
                lessonMaterials,
                mock(CurriculumMaterialManagement.class),
                mock(LiveSessionManagement.class),
                mock(LiveSessionDirectory.class),
                mock(AssetDirectory.class),
                outbox,
                mock(LessonRecordingCleanup.class),
                mock(RecordedVideoManagement.class),
                true);

        MaterialView result = service.attachMaterial(instructorId, lessonId, assetId);

        assertThat(result.embeddingStatus()).isEqualTo("PENDING");
        assertThat(result.keyTermStatus()).isEqualTo("PENDING");
        verify(lessonMaterials).updateEmbeddingStatus(materialId, "PENDING");
        verify(lessonMaterials).updateKeyTermStatus(materialId, "PENDING");

        ArgumentCaptor<String> payload = ArgumentCaptor.forClass(String.class);
        verify(outbox).enqueue(
                eq("material_asset"),
                eq(materialId.toString()),
                eq("MATERIAL_EMBED_REQUESTED"),
                payload.capture(),
                eq("material:" + materialId + ":embed"),
                isNull());
        JsonNode job = JsonMapper.builder().build().readTree(payload.getValue());
        assertThat(job.get("taskType").asString()).isEqualTo("PPTX_EMBED");
        assertThat(job.get("materialId").asString()).isEqualTo(materialId.toString());
        assertThat(job.get("assetId").asString()).isEqualTo(assetId.toString());
        assertThat(job.get("lessonId").asString()).isEqualTo(lessonId.toString());
        assertThat(job.get("curriculumId").asString()).isEqualTo(curriculumId.toString());
        assertThat(job.get("policy").get("embedModel").asString()).isEqualTo("bge-m3");
        assertThat(job.get("policy").get("extractKeyTerms").asBoolean()).isTrue();
        assertThat(job.get("contractVersion").asInt()).isEqualTo(2);
    }
}
