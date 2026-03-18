from enum import Enum


class GetApiV1ImagesIdResponse200Status(str, Enum):
    CREATING = "creating"
    DELETED = "deleted"
    FAILED = "failed"
    READY = "ready"

    def __str__(self) -> str:
        return str(self.value)
