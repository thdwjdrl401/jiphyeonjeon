class StaleMaterialVersionError(ValueError):
    """A delayed material operation would reverse an accepted newer version."""
