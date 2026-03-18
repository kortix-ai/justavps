from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.region_list_response_regions_item import RegionListResponseRegionsItem


T = TypeVar("T", bound="RegionListResponse")


@_attrs_define
class RegionListResponse:
    """
    Attributes:
        provider (str):
        regions (list[RegionListResponseRegionsItem]):
    """

    provider: str
    regions: list[RegionListResponseRegionsItem]

    def to_dict(self) -> dict[str, Any]:
        provider = self.provider

        regions = []
        for regions_item_data in self.regions:
            regions_item = regions_item_data.to_dict()
            regions.append(regions_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "provider": provider,
                "regions": regions,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.region_list_response_regions_item import RegionListResponseRegionsItem

        d = dict(src_dict)
        provider = d.pop("provider")

        regions = []
        _regions = d.pop("regions")
        for regions_item_data in _regions:
            regions_item = RegionListResponseRegionsItem.from_dict(regions_item_data)

            regions.append(regions_item)

        region_list_response = cls(
            provider=provider,
            regions=regions,
        )

        return region_list_response
