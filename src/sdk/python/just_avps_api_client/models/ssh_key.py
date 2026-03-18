from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define

T = TypeVar("T", bound="SSHKey")


@_attrs_define
class SSHKey:
    """
    Attributes:
        id (UUID):
        name (str):
        fingerprint (str):
        created_at (str):
    """

    id: UUID
    name: str
    fingerprint: str
    created_at: str

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        name = self.name

        fingerprint = self.fingerprint

        created_at = self.created_at

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "fingerprint": fingerprint,
                "created_at": created_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = UUID(d.pop("id"))

        name = d.pop("name")

        fingerprint = d.pop("fingerprint")

        created_at = d.pop("created_at")

        ssh_key = cls(
            id=id,
            name=name,
            fingerprint=fingerprint,
            created_at=created_at,
        )

        return ssh_key
