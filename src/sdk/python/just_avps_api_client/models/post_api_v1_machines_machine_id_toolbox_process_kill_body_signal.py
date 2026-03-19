from enum import Enum


class PostApiV1MachinesMachineIdToolboxProcessKillBodySignal(str, Enum):
    HUP = "HUP"
    INT = "INT"
    KILL = "KILL"
    SIGHUP = "SIGHUP"
    SIGINT = "SIGINT"
    SIGKILL = "SIGKILL"
    SIGTERM = "SIGTERM"
    TERM = "TERM"

    def __str__(self) -> str:
        return str(self.value)
