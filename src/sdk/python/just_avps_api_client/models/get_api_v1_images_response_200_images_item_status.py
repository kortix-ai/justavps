from enum import Enum


class GetApiV1ImagesResponse200ImagesItemStatus(str, Enum):
    CREATING = "creating"
    DELETED = "deleted"
    FAILED = "failed"
    READY = "ready"

    def __str__(self) -> str:
        return str(self.value)
