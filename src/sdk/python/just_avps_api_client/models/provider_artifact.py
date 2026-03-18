from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.provider_artifact_architecture import ProviderArtifactArchitecture
from ..types import UNSET, Unset

T = TypeVar("T", bound="ProviderArtifact")


@_attrs_define
class ProviderArtifact:
    """
    Attributes:
        snapshot_id (str | Unset):
        disk_size (int | Unset):
        architecture (ProviderArtifactArchitecture | Unset):
    """

    snapshot_id: str | Unset = UNSET
    disk_size: int | Unset = UNSET
    architecture: ProviderArtifactArchitecture | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        snapshot_id = self.snapshot_id

        disk_size = self.disk_size

        architecture: str | Unset = UNSET
        if not isinstance(self.architecture, Unset):
            architecture = self.architecture.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if snapshot_id is not UNSET:
            field_dict["snapshotId"] = snapshot_id
        if disk_size is not UNSET:
            field_dict["diskSize"] = disk_size
        if architecture is not UNSET:
            field_dict["architecture"] = architecture

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        snapshot_id = d.pop("snapshotId", UNSET)

        disk_size = d.pop("diskSize", UNSET)

        _architecture = d.pop("architecture", UNSET)
        architecture: ProviderArtifactArchitecture | Unset
        if isinstance(_architecture, Unset):
            architecture = UNSET
        else:
            architecture = ProviderArtifactArchitecture(_architecture)

        provider_artifact = cls(
            snapshot_id=snapshot_id,
            disk_size=disk_size,
            architecture=architecture,
        )

        provider_artifact.additional_properties = d
        return provider_artifact

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
