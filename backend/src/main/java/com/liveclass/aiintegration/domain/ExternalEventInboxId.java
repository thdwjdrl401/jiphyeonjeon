package com.liveclass.aiintegration.domain;

import java.io.Serializable;
import java.util.Objects;

public class ExternalEventInboxId implements Serializable {

    private String source;

    private String sourceEventId;

    public ExternalEventInboxId() {
    }

    public ExternalEventInboxId(String source, String sourceEventId) {
        this.source = source;
        this.sourceEventId = sourceEventId;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (o == null || getClass() != o.getClass()) {
            return false;
        }
        ExternalEventInboxId that = (ExternalEventInboxId) o;
        return Objects.equals(source, that.source)
                && Objects.equals(sourceEventId, that.sourceEventId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(source, sourceEventId);
    }
}
