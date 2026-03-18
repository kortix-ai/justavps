from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.provider_list_response_providers_item import ProviderListResponseProvidersItem


T = TypeVar("T", bound="ProviderListResponse")


@_attrs_define
class ProviderListResponse:
    """
    Attributes:
        providers (list[ProviderListResponseProvidersItem]):
    """

    providers: list[ProviderListResponseProvidersItem]

    def to_dict(self) -> dict[str, Any]:
        providers = []
        for providers_item_data in self.providers:
            providers_item = providers_item_data.to_dict()
            providers.append(providers_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "providers": providers,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.provider_list_response_providers_item import ProviderListResponseProvidersItem

        d = dict(src_dict)
        providers = []
        _providers = d.pop("providers")
        for providers_item_data in _providers:
            providers_item = ProviderListResponseProvidersItem.from_dict(providers_item_data)

            providers.append(providers_item)

        provider_list_response = cls(
            providers=providers,
        )

        return provider_list_response
