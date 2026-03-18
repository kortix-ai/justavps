from enum import Enum


class PostApiV1MachinesIdResizeResponse202Action(str, Enum):
    RESIZE = "resize"

    def __str__(self) -> str:
        return str(self.value)
