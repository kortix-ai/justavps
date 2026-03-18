from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="CreateSnapshotBody")


@_attrs_define
class CreateSnapshotBody:
    """
    Attributes:
        docker_image (str): Docker image to bake into the snapshot Example: nginx:latest.
        name (str): Human-readable name Example: my-nginx-snapshot.
        provider (str): Provider to build on Example: hetzner.
        entrypoint (str | Unset): Container entrypoint command Example: sleep infinity.
    """

    docker_image: str
    name: str
    provider: str
    entrypoint: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        docker_image = self.docker_image

        name = self.name

        provider = self.provider

        entrypoint = self.entrypoint

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "docker_image": docker_image,
                "name": name,
                "provider": provider,
            }
        )
        if entrypoint is not UNSET:
            field_dict["entrypoint"] = entrypoint

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        docker_image = d.pop("docker_image")

        name = d.pop("name")

        provider = d.pop("provider")

        entrypoint = d.pop("entrypoint", UNSET)

        create_snapshot_body = cls(
            docker_image=docker_image,
            name=name,
            provider=provider,
            entrypoint=entrypoint,
        )

        create_snapshot_body.additional_properties = d
        return create_snapshot_body

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
