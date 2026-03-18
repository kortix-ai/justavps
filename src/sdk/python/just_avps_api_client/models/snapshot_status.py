from enum import Enum


class SnapshotStatus(str, Enum):
    BUILDING = "building"
    DELETED = "deleted"
    FAILED = "failed"
    READY = "ready"

    def __str__(self) -> str:
        return str(self.value)
