from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.create_webhook_events_item import CreateWebhookEventsItem
from ..types import UNSET, Unset

T = TypeVar("T", bound="CreateWebhook")


@_attrs_define
class CreateWebhook:
    """
    Attributes:
        url (str): HTTPS URL to receive webhook POSTs
        events (list[CreateWebhookEventsItem]): Event types to subscribe to
        secret (str | Unset): HMAC secret (auto-generated if omitted)
    """

    url: str
    events: list[CreateWebhookEventsItem]
    secret: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        url = self.url

        events = []
        for events_item_data in self.events:
            events_item = events_item_data.value
            events.append(events_item)

        secret = self.secret

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "url": url,
                "events": events,
            }
        )
        if secret is not UNSET:
            field_dict["secret"] = secret

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        url = d.pop("url")

        events = []
        _events = d.pop("events")
        for events_item_data in _events:
            events_item = CreateWebhookEventsItem(events_item_data)

            events.append(events_item)

        secret = d.pop("secret", UNSET)

        create_webhook = cls(
            url=url,
            events=events,
            secret=secret,
        )

        return create_webhook
