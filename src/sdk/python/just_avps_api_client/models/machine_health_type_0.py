from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.machine_health_services import MachineHealthServices


T = TypeVar("T", bound="MachineHealthType0")


@_attrs_define
class MachineHealthType0:
    """
    Attributes:
        cpu (float | Unset): CPU usage (0-1) Example: 0.45.
        memory (float | Unset): Memory usage (0-1) Example: 0.62.
        disk (float | Unset): Disk usage (0-1) Example: 0.31.
        services (MachineHealthServices | Unset): Service status map (e.g. code_server, caddy, docker) Example:
            {'code_server': True, 'caddy': True, 'docker': True}.
        last_heartbeat_at (datetime.datetime | None | Unset):
    """

    cpu: float | Unset = UNSET
    memory: float | Unset = UNSET
    disk: float | Unset = UNSET
    services: MachineHealthServices | Unset = UNSET
    last_heartbeat_at: datetime.datetime | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        cpu = self.cpu

        memory = self.memory

        disk = self.disk

        services: dict[str, Any] | Unset = UNSET
        if not isinstance(self.services, Unset):
            services = self.services.to_dict()

        last_heartbeat_at: None | str | Unset
        if isinstance(self.last_heartbeat_at, Unset):
            last_heartbeat_at = UNSET
        elif isinstance(self.last_heartbeat_at, datetime.datetime):
            last_heartbeat_at = self.last_heartbeat_at.isoformat()
        else:
            last_heartbeat_at = self.last_heartbeat_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if cpu is not UNSET:
            field_dict["cpu"] = cpu
        if memory is not UNSET:
            field_dict["memory"] = memory
        if disk is not UNSET:
            field_dict["disk"] = disk
        if services is not UNSET:
            field_dict["services"] = services
        if last_heartbeat_at is not UNSET:
            field_dict["last_heartbeat_at"] = last_heartbeat_at

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.machine_health_services import MachineHealthServices

        d = dict(src_dict)
        cpu = d.pop("cpu", UNSET)

        memory = d.pop("memory", UNSET)

        disk = d.pop("disk", UNSET)

        _services = d.pop("services", UNSET)
        services: MachineHealthServices | Unset
        if isinstance(_services, Unset):
            services = UNSET
        else:
            services = MachineHealthServices.from_dict(_services)

        def _parse_last_heartbeat_at(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                last_heartbeat_at_type_0 = isoparse(data)

                return last_heartbeat_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        last_heartbeat_at = _parse_last_heartbeat_at(d.pop("last_heartbeat_at", UNSET))

        machine_health_type_0 = cls(
            cpu=cpu,
            memory=memory,
            disk=disk,
            services=services,
            last_heartbeat_at=last_heartbeat_at,
        )

        machine_health_type_0.additional_properties = d
        return machine_health_type_0

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
