from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.snapshot_architecture_type_1 import SnapshotArchitectureType1
from ..models.snapshot_architecture_type_2_type_1 import SnapshotArchitectureType2Type1
from ..models.snapshot_architecture_type_3_type_1 import SnapshotArchitectureType3Type1
from ..models.snapshot_status import SnapshotStatus
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.snapshot_providers import SnapshotProviders


T = TypeVar("T", bound="Snapshot")


@_attrs_define
class Snapshot:
    """
    Attributes:
        id (UUID):
        name (str):  Example: my-snapshot.
        is_default (bool): True for the platform base snapshot
        status (SnapshotStatus):
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
        docker_image (None | str | Unset):  Example: nginx:latest.
        entrypoint (None | str | Unset):  Example: sleep infinity.
        architecture (None | SnapshotArchitectureType1 | SnapshotArchitectureType2Type1 | SnapshotArchitectureType3Type1
            | Unset):
        providers (SnapshotProviders | Unset): Per-provider snapshot artifacts
        last_used_at (datetime.datetime | None | Unset):
    """

    id: UUID
    name: str
    is_default: bool
    status: SnapshotStatus
    created_at: datetime.datetime
    updated_at: datetime.datetime
    docker_image: None | str | Unset = UNSET
    entrypoint: None | str | Unset = UNSET
    architecture: (
        None | SnapshotArchitectureType1 | SnapshotArchitectureType2Type1 | SnapshotArchitectureType3Type1 | Unset
    ) = UNSET
    providers: SnapshotProviders | Unset = UNSET
    last_used_at: datetime.datetime | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        name = self.name

        is_default = self.is_default

        status = self.status.value

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        docker_image: None | str | Unset
        if isinstance(self.docker_image, Unset):
            docker_image = UNSET
        else:
            docker_image = self.docker_image

        entrypoint: None | str | Unset
        if isinstance(self.entrypoint, Unset):
            entrypoint = UNSET
        else:
            entrypoint = self.entrypoint

        architecture: None | str | Unset
        if isinstance(self.architecture, Unset):
            architecture = UNSET
        elif isinstance(self.architecture, SnapshotArchitectureType1):
            architecture = self.architecture.value
        elif isinstance(self.architecture, SnapshotArchitectureType2Type1):
            architecture = self.architecture.value
        elif isinstance(self.architecture, SnapshotArchitectureType3Type1):
            architecture = self.architecture.value
        else:
            architecture = self.architecture

        providers: dict[str, Any] | Unset = UNSET
        if not isinstance(self.providers, Unset):
            providers = self.providers.to_dict()

        last_used_at: None | str | Unset
        if isinstance(self.last_used_at, Unset):
            last_used_at = UNSET
        elif isinstance(self.last_used_at, datetime.datetime):
            last_used_at = self.last_used_at.isoformat()
        else:
            last_used_at = self.last_used_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "is_default": is_default,
                "status": status,
                "created_at": created_at,
                "updated_at": updated_at,
            }
        )
        if docker_image is not UNSET:
            field_dict["docker_image"] = docker_image
        if entrypoint is not UNSET:
            field_dict["entrypoint"] = entrypoint
        if architecture is not UNSET:
            field_dict["architecture"] = architecture
        if providers is not UNSET:
            field_dict["providers"] = providers
        if last_used_at is not UNSET:
            field_dict["last_used_at"] = last_used_at

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.snapshot_providers import SnapshotProviders

        d = dict(src_dict)
        id = UUID(d.pop("id"))

        name = d.pop("name")

        is_default = d.pop("is_default")

        status = SnapshotStatus(d.pop("status"))

        created_at = isoparse(d.pop("created_at"))

        updated_at = isoparse(d.pop("updated_at"))

        def _parse_docker_image(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        docker_image = _parse_docker_image(d.pop("docker_image", UNSET))

        def _parse_entrypoint(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        entrypoint = _parse_entrypoint(d.pop("entrypoint", UNSET))

        def _parse_architecture(
            data: object,
        ) -> None | SnapshotArchitectureType1 | SnapshotArchitectureType2Type1 | SnapshotArchitectureType3Type1 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                architecture_type_1 = SnapshotArchitectureType1(data)

                return architecture_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                architecture_type_2_type_1 = SnapshotArchitectureType2Type1(data)

                return architecture_type_2_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                architecture_type_3_type_1 = SnapshotArchitectureType3Type1(data)

                return architecture_type_3_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                None
                | SnapshotArchitectureType1
                | SnapshotArchitectureType2Type1
                | SnapshotArchitectureType3Type1
                | Unset,
                data,
            )

        architecture = _parse_architecture(d.pop("architecture", UNSET))

        _providers = d.pop("providers", UNSET)
        providers: SnapshotProviders | Unset
        if isinstance(_providers, Unset):
            providers = UNSET
        else:
            providers = SnapshotProviders.from_dict(_providers)

        def _parse_last_used_at(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                last_used_at_type_0 = isoparse(data)

                return last_used_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        last_used_at = _parse_last_used_at(d.pop("last_used_at", UNSET))

        snapshot = cls(
            id=id,
            name=name,
            is_default=is_default,
            status=status,
            created_at=created_at,
            updated_at=updated_at,
            docker_image=docker_image,
            entrypoint=entrypoint,
            architecture=architecture,
            providers=providers,
            last_used_at=last_used_at,
        )

        snapshot.additional_properties = d
        return snapshot

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
