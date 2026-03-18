from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.agent_heartbeat_body_load import AgentHeartbeatBodyLoad
    from ..models.agent_heartbeat_body_services import AgentHeartbeatBodyServices


T = TypeVar("T", bound="AgentHeartbeatBody")


@_attrs_define
class AgentHeartbeatBody:
    """
    Attributes:
        slug (str):  Example: abc123.
        machine_token (str):
        uptime (float): Uptime in seconds
        services (AgentHeartbeatBodyServices):  Example: {'code_server': True, 'caddy': True}.
        load (AgentHeartbeatBodyLoad):
    """

    slug: str
    machine_token: str
    uptime: float
    services: AgentHeartbeatBodyServices
    load: AgentHeartbeatBodyLoad
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        machine_token = self.machine_token

        uptime = self.uptime

        services = self.services.to_dict()

        load = self.load.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        from ..models.agent_heartbeat_body_load import AgentHeartbeatBodyLoad
        from ..models.agent_heartbeat_body_services import AgentHeartbeatBodyServices

        d = dict(src_dict)
        slug = d.pop("slug")

        machine_token = d.pop("machine_token")

        uptime = d.pop("uptime")

        services = AgentHeartbeatBodyServices.from_dict(d.pop("services"))

        load = AgentHeartbeatBodyLoad.from_dict(d.pop("load"))

        agent_heartbeat_body = cls(
            slug=slug,
            machine_token=machine_token,
            uptime=uptime,
            services=services,
            load=load,
        )

        agent_heartbeat_body.additional_properties = d
        return agent_heartbeat_body

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
