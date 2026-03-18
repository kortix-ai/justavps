from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiV1InternalHeartbeatBodyLoad")


@_attrs_define
class PostApiV1InternalHeartbeatBodyLoad:
    """
    Attributes:
        cpu (float):
        memory (float):
        disk (float):
    """

    cpu: float
    memory: float
    disk: float
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        cpu = self.cpu

        memory = self.memory

        disk = self.disk

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        post_api_v1_internal_heartbeat_body_load = cls(
            cpu=cpu,
            memory=memory,
            disk=disk,
        )

        post_api_v1_internal_heartbeat_body_load.additional_properties = d
        return post_api_v1_internal_heartbeat_body_load

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
