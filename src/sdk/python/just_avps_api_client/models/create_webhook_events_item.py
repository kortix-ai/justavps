from enum import Enum


class CreateWebhookEventsItem(str, Enum):
    MACHINE_HEARTBEAT = "machine.heartbeat"
    MACHINE_STAGE_CHANGED = "machine.stage_changed"
    MACHINE_STATUS_CHANGED = "machine.status_changed"
    VALUE_0 = "*"

    def __str__(self) -> str:
        return str(self.value)
