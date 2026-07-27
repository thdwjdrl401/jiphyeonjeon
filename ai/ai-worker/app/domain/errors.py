class StaleMaterialVersionError(ValueError):
    """A delayed material operation would reverse an accepted newer version."""


class MaterialIngestionError(ValueError):
    """A permanent PPTX ingestion input or contract failure."""


class InvalidPptxError(MaterialIngestionError):
    """The source is not a safe, supported PPTX package."""


class PptxLimitExceededError(InvalidPptxError):
    """The source exceeds a configured ingestion resource boundary."""


class EmptyPptxContentError(MaterialIngestionError):
    """A valid PPTX contains no supported indexable text."""


class EmbeddingContractError(MaterialIngestionError):
    """The embedding adapter response does not match the storage contract."""
