from enum import Enum


class GetApiV1MachinesMachineIdToolboxFilesResponse200EntriesItemType(str, Enum):
    DIR = "dir"
    FILE = "file"

    def __str__(self) -> str:
        return str(self.value)
