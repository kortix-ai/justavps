from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="APIKeyListResponseApiKeysItem")


@_attrs_define
class APIKeyListResponseApiKeysItem:
    """
    Attributes:
        id (UUID):
        name (str):
        key_prefix (str):
        created_at (str):
        last_used (None | str):
        key (str | Unset): Only returned on creation
    """

    id: UUID
    name: str
    key_prefix: str
    created_at: str
    last_used: None | str
    key: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        name = self.name

        key_prefix = self.key_prefix

        created_at = self.created_at

        last_used: None | str
        last_used = self.last_used

        key = self.key

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "key_prefix": key_prefix,
                "created_at": created_at,
                "last_used": last_used,
            }
        )
        if key is not UNSET:
            field_dict["key"] = key

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = UUID(d.pop("id"))

        name = d.pop("name")

        key_prefix = d.pop("key_prefix")

        created_at = d.pop("created_at")

        def _parse_last_used(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        last_used = _parse_last_used(d.pop("last_used"))

        key = d.pop("key", UNSET)

        api_key_list_response_api_keys_item = cls(
            id=id,
            name=name,
            key_prefix=key_prefix,
            created_at=created_at,
            last_used=last_used,
            key=key,
        )

        return api_key_list_response_api_keys_item
