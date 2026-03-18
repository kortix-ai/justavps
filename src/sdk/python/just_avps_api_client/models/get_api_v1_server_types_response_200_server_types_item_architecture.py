from enum import Enum


class GetApiV1ServerTypesResponse200ServerTypesItemArchitecture(str, Enum):
    ARM = "arm"
    X86 = "x86"

    def __str__(self) -> str:
        return str(self.value)
