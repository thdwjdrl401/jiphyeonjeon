package com.liveclass.curriculum;

import com.liveclass.aiintegration.api.OutboxDestinations;
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
import org.springframework.context.ApplicationEventPublisher;
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
                mock(ApplicationEventPublisher.class),
                mock(RecordedVideoManagement.class),
                true);

        MaterialView result = service.attachMaterial(instructorId, lessonId, assetId);

        assertThat(result.embeddingStatus()).isEqualTo("PENDING");
        assertThat(result.keyTermStatus()).isEqualTo("PENDING");
        verify(lessonMaterials).updateEmbeddingStatus(materialId, "PENDING");
        verify(lessonMaterials).updateKeyTermStatus(materialId, "PENDING");

        ArgumentCaptor<String> payload = ArgumentCaptor.forClass(String.class);
        verify(outbox).enqueue(
                eq(OutboxDestinations.INGESTION_EMBED),
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

    /**
     * 커리큘럼 자료도 레슨 자료와 <b>같은 v2 봉투</b>를 쓴다. 예전에는 v1이라 용어 추출을 요청하지
     * 않았는데, 워커는 v1에서도 용어를 뽑으면서 결과 봉투(outputs)는 v2에서만 실었다. 그래서 ai 쪽에는
     * 용어가 쌓이고 화면은 NOT_REQUESTED로 남는 상태가 운영에 그대로 있었다.
     */
    @Test
    void curriculum_material_attach_publishes_the_same_v2_job_and_requests_key_terms() {
        UUID instructorId = UUID.randomUUID();
        UUID curriculumId = UUID.randomUUID();
        UUID assetId = UUID.randomUUID();
        UUID materialId = UUID.randomUUID();

        CurriculumRepository curriculumRepository = mock(CurriculumRepository.class);
        CurriculumMaterialManagement curriculumMaterials = mock(CurriculumMaterialManagement.class);
        OutboxPublisher outbox = mock(OutboxPublisher.class);

        Curriculum curriculum = new Curriculum();
        curriculum.setId(curriculumId);
        curriculum.setInstructorId(instructorId);
        MaterialView attached = new MaterialView(
                materialId, assetId, "deck.pptx", 1024L, "ACTIVE", "READY", "NOT_REQUESTED");

        when(curriculumRepository.findById(curriculumId)).thenReturn(Optional.of(curriculum));
        when(curriculumMaterials.attach(curriculumId, assetId, instructorId)).thenReturn(attached);

        InstructorCurriculumService service = new InstructorCurriculumService(
                curriculumRepository,
                mock(SectionRepository.class),
                mock(LessonDirectory.class),
                mock(LessonManagement.class),
                mock(LessonMaterialManagement.class),
                curriculumMaterials,
                mock(LiveSessionManagement.class),
                mock(LiveSessionDirectory.class),
                mock(AssetDirectory.class),
                outbox,
                mock(LessonRecordingCleanup.class),
                mock(ApplicationEventPublisher.class),
                mock(RecordedVideoManagement.class),
                true);

        MaterialView result = service.attachCurriculumMaterial(instructorId, curriculumId, assetId);

        assertThat(result.embeddingStatus()).isEqualTo("PENDING");
        // NOT_REQUESTED에서 갈 수 있는 곳은 PENDING뿐이다. 이걸 안 찍으면 결과 callback을 못 받아 적는다.
        assertThat(result.keyTermStatus()).isEqualTo("PENDING");
        verify(curriculumMaterials).updateEmbeddingStatus(materialId, "PENDING");
        verify(curriculumMaterials).updateKeyTermStatus(materialId, "PENDING");

        ArgumentCaptor<String> payload = ArgumentCaptor.forClass(String.class);
        verify(outbox).enqueue(
                eq(OutboxDestinations.INGESTION_EMBED),
                eq("material_asset"),
                eq(materialId.toString()),
                eq("MATERIAL_EMBED_REQUESTED"),
                payload.capture(),
                eq("material:" + materialId + ":embed"),
                isNull());
        JsonNode job = JsonMapper.builder().build().readTree(payload.getValue());
        assertThat(job.get("taskType").asString()).isEqualTo("PPTX_EMBED");
        assertThat(job.get("scope").asString()).isEqualTo("CURRICULUM");
        // 커리큘럼 자료에는 레슨이 없다. 실으면 워커가 모순된 payload로 거부한다(ADR-0045 §2).
        assertThat(job.hasNonNull("lessonId")).isFalse();
        assertThat(job.get("curriculumId").asString()).isEqualTo(curriculumId.toString());
        assertThat(job.get("policy").get("extractKeyTerms").asBoolean()).isTrue();
        assertThat(job.get("contractVersion").asInt()).isEqualTo(2);
    }
}
