from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_v1_server_types_response_200_server_types_item import (
        GetApiV1ServerTypesResponse200ServerTypesItem,
    )


T = TypeVar("T", bound="GetApiV1ServerTypesResponse200")


@_attrs_define
class GetApiV1ServerTypesResponse200:
    """
    Attributes:
        provider (str):
        region (str):
        server_types (list[GetApiV1ServerTypesResponse200ServerTypesItem]):
    """

    provider: str
    region: str
    server_types: list[GetApiV1ServerTypesResponse200ServerTypesItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        provider = self.provider

        region = self.region

        server_types = []
        for server_types_item_data in self.server_types:
            server_types_item = server_types_item_data.to_dict()
            server_types.append(server_types_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "provider": provider,
                "region": region,
                "server_types": server_types,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_v1_server_types_response_200_server_types_item import (
            GetApiV1ServerTypesResponse200ServerTypesItem,
        )

        d = dict(src_dict)
        provider = d.pop("provider")

        region = d.pop("region")

        server_types = []
        _server_types = d.pop("server_types")
        for server_types_item_data in _server_types:
            server_types_item = GetApiV1ServerTypesResponse200ServerTypesItem.from_dict(server_types_item_data)

            server_types.append(server_types_item)

        get_api_v1_server_types_response_200 = cls(
            provider=provider,
            region=region,
            server_types=server_types,
        )

        get_api_v1_server_types_response_200.additional_properties = d
        return get_api_v1_server_types_response_200

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
