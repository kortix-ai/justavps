from enum import Enum


class ImageStatus(str, Enum):
    CREATING = "creating"
    DELETED = "deleted"
    FAILED = "failed"
    READY = "ready"

    def __str__(self) -> str:
        return str(self.value)
