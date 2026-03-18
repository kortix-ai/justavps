from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_v1_machines_id_response_200_health_type_0_services import (
        GetApiV1MachinesIdResponse200HealthType0Services,
    )


T = TypeVar("T", bound="GetApiV1MachinesIdResponse200HealthType0")


@_attrs_define
class GetApiV1MachinesIdResponse200HealthType0:
    """
    Attributes:
        cpu (float):
        memory (float):
        disk (float):
        services (GetApiV1MachinesIdResponse200HealthType0Services):
        last_heartbeat_at (None | str):
    """

    cpu: float
    memory: float
    disk: float
    services: GetApiV1MachinesIdResponse200HealthType0Services
    last_heartbeat_at: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        cpu = self.cpu

        memory = self.memory

        disk = self.disk

        services = self.services.to_dict()

        last_heartbeat_at: None | str
        last_heartbeat_at = self.last_heartbeat_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        from ..models.get_api_v1_machines_id_response_200_health_type_0_services import (
            GetApiV1MachinesIdResponse200HealthType0Services,
        )

        d = dict(src_dict)
        cpu = d.pop("cpu")

        memory = d.pop("memory")

        disk = d.pop("disk")

        services = GetApiV1MachinesIdResponse200HealthType0Services.from_dict(d.pop("services"))

        def _parse_last_heartbeat_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        last_heartbeat_at = _parse_last_heartbeat_at(d.pop("last_heartbeat_at"))

        get_api_v1_machines_id_response_200_health_type_0 = cls(
            cpu=cpu,
            memory=memory,
            disk=disk,
            services=services,
            last_heartbeat_at=last_heartbeat_at,
        )

        get_api_v1_machines_id_response_200_health_type_0.additional_properties = d
        return get_api_v1_machines_id_response_200_health_type_0

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
