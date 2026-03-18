from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="HeartbeatLoad")


@_attrs_define
class HeartbeatLoad:
    """
    Attributes:
        cpu (float):
        memory (float):
        disk (float):
    """

    cpu: float
    memory: float
    disk: float

    def to_dict(self) -> dict[str, Any]:
        cpu = self.cpu

        memory = self.memory

        disk = self.disk

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "cpu": cpu,
                "memory": memory,
                "disk": disk,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        cpu = d.pop("cpu")

        memory = d.pop("memory")

        disk = d.pop("disk")

        heartbeat_load = cls(
            cpu=cpu,
            memory=memory,
            disk=disk,
        )

        return heartbeat_load
