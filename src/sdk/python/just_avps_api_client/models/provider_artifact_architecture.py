from enum import Enum


class ProviderArtifactArchitecture(str, Enum):
    ARM = "arm"
    X86 = "x86"

    def __str__(self) -> str:
        return str(self.value)
