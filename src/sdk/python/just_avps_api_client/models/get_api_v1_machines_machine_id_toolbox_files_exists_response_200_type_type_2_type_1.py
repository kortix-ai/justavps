from enum import Enum


class GetApiV1MachinesMachineIdToolboxFilesExistsResponse200TypeType2Type1(str, Enum):
    DIR = "dir"
    FILE = "file"

    def __str__(self) -> str:
        return str(self.value)
