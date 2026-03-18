from enum import Enum


class MachineStatus(str, Enum):
    DELETED = "deleted"
    ERROR = "error"
    PROVISIONING = "provisioning"
    READY = "ready"
    STOPPED = "stopped"

    def __str__(self) -> str:
        return str(self.value)
