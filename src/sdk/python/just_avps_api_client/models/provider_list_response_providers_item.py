from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ProviderListResponseProvidersItem")


@_attrs_define
class ProviderListResponseProvidersItem:
    """
    Attributes:
        name (str):
        display_name (str):
    """

    name: str
    display_name: str

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        display_name = self.display_name

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "displayName": display_name,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        display_name = d.pop("displayName")

        provider_list_response_providers_item = cls(
            name=name,
            display_name=display_name,
        )

        return provider_list_response_providers_item
