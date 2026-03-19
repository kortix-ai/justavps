from enum import Enum


class PostApiV1MachinesMachineIdToolboxFilesUploadResponse200Type(str, Enum):
    FILE = "file"

    def __str__(self) -> str:
        return str(self.value)
