from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.api_key_list_response_api_keys_item import APIKeyListResponseApiKeysItem


T = TypeVar("T", bound="APIKeyListResponse")


@_attrs_define
class APIKeyListResponse:
    """
    Attributes:
        api_keys (list[APIKeyListResponseApiKeysItem]):
    """

    api_keys: list[APIKeyListResponseApiKeysItem]

    def to_dict(self) -> dict[str, Any]:
        api_keys = []
        for api_keys_item_data in self.api_keys:
            api_keys_item = api_keys_item_data.to_dict()
            api_keys.append(api_keys_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "api_keys": api_keys,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.api_key_list_response_api_keys_item import APIKeyListResponseApiKeysItem

        d = dict(src_dict)
        api_keys = []
        _api_keys = d.pop("api_keys")
        for api_keys_item_data in _api_keys:
            api_keys_item = APIKeyListResponseApiKeysItem.from_dict(api_keys_item_data)

            api_keys.append(api_keys_item)

        api_key_list_response = cls(
            api_keys=api_keys,
        )

        return api_key_list_response
