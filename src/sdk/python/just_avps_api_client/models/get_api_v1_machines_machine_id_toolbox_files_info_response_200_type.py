from enum import Enum


class GetApiV1MachinesMachineIdToolboxFilesInfoResponse200Type(str, Enum):
    DIR = "dir"
    FILE = "file"

    def __str__(self) -> str:
        return str(self.value)
