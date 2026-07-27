class RagStreamFailure(Exception):
    """Known adapter failure whose public representation is owned by the RAG service."""

    def __init__(self, *, code: str) -> None:
        super().__init__(code)
        self.code = code
