from enum import Enum


class GetApiV1ServerTypesResponse200ServerTypesItemCpuType(str, Enum):
    DEDICATED = "dedicated"
    SHARED = "shared"

    def __str__(self) -> str:
        return str(self.value)
