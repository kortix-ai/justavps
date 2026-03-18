from enum import Enum


class SnapshotArchitectureType2Type1(str, Enum):
    ARM = "arm"
    X86 = "x86"

    def __str__(self) -> str:
        return str(self.value)
