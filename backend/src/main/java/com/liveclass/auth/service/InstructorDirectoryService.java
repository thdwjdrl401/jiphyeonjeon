package com.liveclass.auth.service;

import com.liveclass.auth.api.InstructorDirectory;
import com.liveclass.auth.api.InstructorSummaryView;
import com.liveclass.auth.domain.AppUser;
import com.liveclass.auth.domain.InstructorProfile;
import com.liveclass.auth.repository.AppUserRepository;
import com.liveclass.auth.repository.InstructorProfileRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/** InstructorDirectory 구현 — auth 내부 엔티티를 경계 DTO로 변환한다. */
@Service
public class InstructorDirectoryService implements InstructorDirectory {

    private final AppUserRepository appUserRepository;
    private final InstructorProfileRepository instructorProfileRepository;

    public InstructorDirectoryService(AppUserRepository appUserRepository,
                                      InstructorProfileRepository instructorProfileRepository) {
        this.appUserRepository = appUserRepository;
        this.instructorProfileRepository = instructorProfileRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public List<InstructorSummaryView> findSummaries(Collection<UUID> instructorIds) {
        if (instructorIds.isEmpty()) {
            return List.of();
        }
        // 프로필은 강사가 아직 안 채웠을 수 있어 별도로 모아 없으면 null/빈 값으로 둔다.
        Map<UUID, InstructorProfile> profiles = instructorProfileRepository.findAllById(instructorIds).stream()
                .collect(Collectors.toMap(InstructorProfile::getUserId, Function.identity()));

        return appUserRepository.findAllById(instructorIds).stream()
                .map(user -> toView(user, profiles.get(user.getId())))
                .toList();
    }

    private InstructorSummaryView toView(AppUser user, InstructorProfile profile) {
        return new InstructorSummaryView(
                user.getId(),
                user.getDisplayName(),
                profile != null ? profile.getBio() : null,
                profile != null ? profile.getExpertise() : List.of());
    }
}
