package com.liveclass.aiintegration.repository;

import com.liveclass.aiintegration.domain.ExternalEventInbox;
import com.liveclass.aiintegration.domain.ExternalEventInboxId;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ExternalEventInboxRepository
        extends JpaRepository<ExternalEventInbox, ExternalEventInboxId> {
}
