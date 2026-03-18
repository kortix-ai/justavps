from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.webhook_list_response_webhooks_item import WebhookListResponseWebhooksItem


T = TypeVar("T", bound="WebhookListResponse")


@_attrs_define
class WebhookListResponse:
    """
    Attributes:
        webhooks (list[WebhookListResponseWebhooksItem]):
    """

    webhooks: list[WebhookListResponseWebhooksItem]

    def to_dict(self) -> dict[str, Any]:
        webhooks = []
        for webhooks_item_data in self.webhooks:
            webhooks_item = webhooks_item_data.to_dict()
            webhooks.append(webhooks_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "webhooks": webhooks,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.webhook_list_response_webhooks_item import WebhookListResponseWebhooksItem

        d = dict(src_dict)
        webhooks = []
        _webhooks = d.pop("webhooks")
        for webhooks_item_data in _webhooks:
            webhooks_item = WebhookListResponseWebhooksItem.from_dict(webhooks_item_data)

            webhooks.append(webhooks_item)

        webhook_list_response = cls(
            webhooks=webhooks,
        )

        return webhook_list_response
