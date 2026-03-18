from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.machine_list_response_machines_item_health_type_0_services import (
        MachineListResponseMachinesItemHealthType0Services,
    )


T = TypeVar("T", bound="MachineListResponseMachinesItemHealthType0")


@_attrs_define
class MachineListResponseMachinesItemHealthType0:
    """
    Attributes:
        cpu (float):
        memory (float):
        disk (float):
        services (MachineListResponseMachinesItemHealthType0Services):
        last_heartbeat_at (None | str):
    """

    cpu: float
    memory: float
    disk: float
    services: MachineListResponseMachinesItemHealthType0Services
    last_heartbeat_at: None | str

    def to_dict(self) -> dict[str, Any]:
        cpu = self.cpu

        memory = self.memory

        disk = self.disk

        services = self.services.to_dict()

        last_heartbeat_at: None | str
        last_heartbeat_at = self.last_heartbeat_at

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "cpu": cpu,
                "memory": memory,
                "disk": disk,
                "services": services,
                "last_heartbeat_at": last_heartbeat_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.machine_list_response_machines_item_health_type_0_services import (
            MachineListResponseMachinesItemHealthType0Services,
        )

        d = dict(src_dict)
        cpu = d.pop("cpu")

        memory = d.pop("memory")

        disk = d.pop("disk")

        services = MachineListResponseMachinesItemHealthType0Services.from_dict(d.pop("services"))

        def _parse_last_heartbeat_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        last_heartbeat_at = _parse_last_heartbeat_at(d.pop("last_heartbeat_at"))

        machine_list_response_machines_item_health_type_0 = cls(
            cpu=cpu,
            memory=memory,
            disk=disk,
            services=services,
            last_heartbeat_at=last_heartbeat_at,
        )

        return machine_list_response_machines_item_health_type_0
