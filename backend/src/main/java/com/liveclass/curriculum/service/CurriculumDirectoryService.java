package com.liveclass.curriculum.service;

import com.liveclass.curriculum.api.CurriculumDirectory;
import com.liveclass.curriculum.api.CurriculumView;
import com.liveclass.curriculum.repository.CurriculumRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;

/** {@link CurriculumDirectory} 구현. 읽기 전용 어댑터라 정책 판단을 하지 않는다. */
@Service
public class CurriculumDirectoryService implements CurriculumDirectory {

    private final CurriculumRepository curriculumRepository;

    public CurriculumDirectoryService(CurriculumRepository curriculumRepository) {
        this.curriculumRepository = curriculumRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<CurriculumView> findById(UUID curriculumId) {
        if (curriculumId == null) {
            return Optional.empty();
        }
        return curriculumRepository.findById(curriculumId)
                .map(c -> new CurriculumView(c.getId(), c.getInstructorId(), c.getTitle(),
                        c.getLifecycleStatus() == null ? null : c.getLifecycleStatus().name()));
    }
}
