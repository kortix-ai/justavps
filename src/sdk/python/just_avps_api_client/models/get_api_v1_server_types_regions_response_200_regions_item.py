from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetApiV1ServerTypesRegionsResponse200RegionsItem")


@_attrs_define
class GetApiV1ServerTypesRegionsResponse200RegionsItem:
    """
    Attributes:
        id (str):
        name (str):
        country (str):
        city (str):
    """

    id: str
    name: str
    country: str
    city: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        country = self.country

        city = self.city

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "country": country,
                "city": city,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        country = d.pop("country")

        city = d.pop("city")

        get_api_v1_server_types_regions_response_200_regions_item = cls(
            id=id,
            name=name,
            country=country,
            city=city,
        )

        get_api_v1_server_types_regions_response_200_regions_item.additional_properties = d
        return get_api_v1_server_types_regions_response_200_regions_item

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
