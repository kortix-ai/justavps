from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.heartbeat_load import HeartbeatLoad
    from ..models.heartbeat_services import HeartbeatServices


T = TypeVar("T", bound="Heartbeat")


@_attrs_define
class Heartbeat:
    """
    Attributes:
        slug (str):
        machine_token (str):
        uptime (float):
        services (HeartbeatServices):
        load (HeartbeatLoad):
    """

    slug: str
    machine_token: str
    uptime: float
    services: HeartbeatServices
    load: HeartbeatLoad

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        machine_token = self.machine_token

        uptime = self.uptime

        services = self.services.to_dict()

        load = self.load.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "machine_token": machine_token,
                "uptime": uptime,
                "services": services,
                "load": load,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.heartbeat_load import HeartbeatLoad
        from ..models.heartbeat_services import HeartbeatServices

        d = dict(src_dict)
        slug = d.pop("slug")

        machine_token = d.pop("machine_token")

        uptime = d.pop("uptime")

        services = HeartbeatServices.from_dict(d.pop("services"))

        load = HeartbeatLoad.from_dict(d.pop("load"))

        heartbeat = cls(
            slug=slug,
            machine_token=machine_token,
            uptime=uptime,
            services=services,
            load=load,
        )

        return heartbeat
