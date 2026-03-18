from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.server_type_list_response_server_types_item import ServerTypeListResponseServerTypesItem


T = TypeVar("T", bound="ServerTypeListResponse")


@_attrs_define
class ServerTypeListResponse:
    """
    Attributes:
        provider (str):
        region (str):
        server_types (list[ServerTypeListResponseServerTypesItem]):
    """

    provider: str
    region: str
    server_types: list[ServerTypeListResponseServerTypesItem]

    def to_dict(self) -> dict[str, Any]:
        provider = self.provider

        region = self.region

        server_types = []
        for server_types_item_data in self.server_types:
            server_types_item = server_types_item_data.to_dict()
            server_types.append(server_types_item)

        field_dict: dict[str, Any] = {}

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
        from ..models.server_type_list_response_server_types_item import ServerTypeListResponseServerTypesItem

        d = dict(src_dict)
        provider = d.pop("provider")

        region = d.pop("region")

        server_types = []
        _server_types = d.pop("server_types")
        for server_types_item_data in _server_types:
            server_types_item = ServerTypeListResponseServerTypesItem.from_dict(server_types_item_data)

            server_types.append(server_types_item)

        server_type_list_response = cls(
            provider=provider,
            region=region,
            server_types=server_types,
        )

        return server_type_list_response
