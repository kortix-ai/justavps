from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_v1_webhooks_response_200_webhooks_item import GetApiV1WebhooksResponse200WebhooksItem


T = TypeVar("T", bound="GetApiV1WebhooksResponse200")


@_attrs_define
class GetApiV1WebhooksResponse200:
    """
    Attributes:
        webhooks (list[GetApiV1WebhooksResponse200WebhooksItem]):
    """

    webhooks: list[GetApiV1WebhooksResponse200WebhooksItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        webhooks = []
        for webhooks_item_data in self.webhooks:
            webhooks_item = webhooks_item_data.to_dict()
            webhooks.append(webhooks_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "webhooks": webhooks,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_v1_webhooks_response_200_webhooks_item import GetApiV1WebhooksResponse200WebhooksItem

        d = dict(src_dict)
        webhooks = []
        _webhooks = d.pop("webhooks")
        for webhooks_item_data in _webhooks:
            webhooks_item = GetApiV1WebhooksResponse200WebhooksItem.from_dict(webhooks_item_data)

            webhooks.append(webhooks_item)

        get_api_v1_webhooks_response_200 = cls(
            webhooks=webhooks,
        )

        get_api_v1_webhooks_response_200.additional_properties = d
        return get_api_v1_webhooks_response_200

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
