from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.image_status import ImageStatus

T = TypeVar("T", bound="Image")


@_attrs_define
class Image:
    """
    Attributes:
        id (UUID):
        name (str):
        status (ImageStatus):
        source_machine_id (None | UUID):
        provider (str):
        provider_image_id (None | str):
        disk_size_gb (float | None):
        architecture (None | str):
        created_at (str):
        updated_at (str):
    """

    id: UUID
    name: str
    status: ImageStatus
    source_machine_id: None | UUID
    provider: str
    provider_image_id: None | str
    disk_size_gb: float | None
    architecture: None | str
    created_at: str
    updated_at: str

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        name = self.name

        status = self.status.value

        source_machine_id: None | str
        if isinstance(self.source_machine_id, UUID):
            source_machine_id = str(self.source_machine_id)
        else:
            source_machine_id = self.source_machine_id

        provider = self.provider

        provider_image_id: None | str
        provider_image_id = self.provider_image_id

        disk_size_gb: float | None
        disk_size_gb = self.disk_size_gb

        architecture: None | str
        architecture = self.architecture

        created_at = self.created_at

        updated_at = self.updated_at

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "status": status,
                "source_machine_id": source_machine_id,
                "provider": provider,
                "provider_image_id": provider_image_id,
                "disk_size_gb": disk_size_gb,
                "architecture": architecture,
                "created_at": created_at,
                "updated_at": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = UUID(d.pop("id"))

        name = d.pop("name")

        status = ImageStatus(d.pop("status"))

        def _parse_source_machine_id(data: object) -> None | UUID:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                source_machine_id_type_0 = UUID(data)

                return source_machine_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | UUID, data)

        source_machine_id = _parse_source_machine_id(d.pop("source_machine_id"))

        provider = d.pop("provider")

        def _parse_provider_image_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        provider_image_id = _parse_provider_image_id(d.pop("provider_image_id"))

        def _parse_disk_size_gb(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        disk_size_gb = _parse_disk_size_gb(d.pop("disk_size_gb"))

        def _parse_architecture(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        architecture = _parse_architecture(d.pop("architecture"))

        created_at = d.pop("created_at")

        updated_at = d.pop("updated_at")

        image = cls(
            id=id,
            name=name,
            status=status,
            source_machine_id=source_machine_id,
            provider=provider,
            provider_image_id=provider_image_id,
            disk_size_gb=disk_size_gb,
            architecture=architecture,
            created_at=created_at,
            updated_at=updated_at,
        )

        return image
