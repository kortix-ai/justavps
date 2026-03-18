from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiV1SshKeysResponse201")


@_attrs_define
class PostApiV1SshKeysResponse201:
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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        name = self.name

        fingerprint = self.fingerprint

        created_at = self.created_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        post_api_v1_ssh_keys_response_201 = cls(
            id=id,
            name=name,
            fingerprint=fingerprint,
            created_at=created_at,
        )

        post_api_v1_ssh_keys_response_201.additional_properties = d
        return post_api_v1_ssh_keys_response_201

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
