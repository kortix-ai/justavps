from enum import Enum


class GetApiV1MachinesResponse200MachinesItemStatus(str, Enum):
    DELETED = "deleted"
    ERROR = "error"
    PROVISIONING = "provisioning"
    READY = "ready"
    STOPPED = "stopped"

    def __str__(self) -> str:
        return str(self.value)
