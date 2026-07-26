from dataclasses import dataclass


@dataclass
class RuntimeState:
    ready: bool = False
