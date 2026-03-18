from enum import Enum


class PostApiV1MachinesResponse202Status(str, Enum):
    DELETED = "deleted"
    ERROR = "error"
    PROVISIONING = "provisioning"
    READY = "ready"
    STOPPED = "stopped"

    def __str__(self) -> str:
        return str(self.value)
