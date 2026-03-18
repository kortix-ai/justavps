from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="RegionListResponseRegionsItem")


@_attrs_define
class RegionListResponseRegionsItem:
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

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        country = self.country

        city = self.city

        field_dict: dict[str, Any] = {}

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

        region_list_response_regions_item = cls(
            id=id,
            name=name,
            country=country,
            city=city,
        )

        return region_list_response_regions_item
