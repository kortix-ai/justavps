from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.server_type import ServerType


T = TypeVar("T", bound="ListServerTypesResponse200")


@_attrs_define
class ListServerTypesResponse200:
    """
    Attributes:
        provider (str | Unset):
        region (str | Unset):
        server_types (list[ServerType] | Unset):
    """

    provider: str | Unset = UNSET
    region: str | Unset = UNSET
    server_types: list[ServerType] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        provider = self.provider

        region = self.region

        server_types: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.server_types, Unset):
            server_types = []
            for server_types_item_data in self.server_types:
                server_types_item = server_types_item_data.to_dict()
                server_types.append(server_types_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if provider is not UNSET:
            field_dict["provider"] = provider
        if region is not UNSET:
            field_dict["region"] = region
        if server_types is not UNSET:
            field_dict["server_types"] = server_types

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.server_type import ServerType

        d = dict(src_dict)
        provider = d.pop("provider", UNSET)

        region = d.pop("region", UNSET)

        _server_types = d.pop("server_types", UNSET)
        server_types: list[ServerType] | Unset = UNSET
        if _server_types is not UNSET:
            server_types = []
            for server_types_item_data in _server_types:
                server_types_item = ServerType.from_dict(server_types_item_data)

                server_types.append(server_types_item)

        list_server_types_response_200 = cls(
            provider=provider,
            region=region,
            server_types=server_types,
        )

        list_server_types_response_200.additional_properties = d
        return list_server_types_response_200

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
