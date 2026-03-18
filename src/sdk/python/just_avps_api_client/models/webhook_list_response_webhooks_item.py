from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

T = TypeVar("T", bound="WebhookListResponseWebhooksItem")


@_attrs_define
class WebhookListResponseWebhooksItem:
    """
    Attributes:
        id (UUID):
        url (str):
        events (list[str]):
        active (bool):
        created_at (str):
    """

    id: UUID
    url: str
    events: list[str]
    active: bool
    created_at: str

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        url = self.url

        events = self.events

        active = self.active

        created_at = self.created_at

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "url": url,
                "events": events,
                "active": active,
                "created_at": created_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = UUID(d.pop("id"))

        url = d.pop("url")

        events = cast(list[str], d.pop("events"))

        active = d.pop("active")

        created_at = d.pop("created_at")

        webhook_list_response_webhooks_item = cls(
            id=id,
            url=url,
            events=events,
            active=active,
            created_at=created_at,
        )

        return webhook_list_response_webhooks_item
