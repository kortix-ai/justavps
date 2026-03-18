from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_v1_webhooks_body_events_item import PostApiV1WebhooksBodyEventsItem
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiV1WebhooksBody")


@_attrs_define
class PostApiV1WebhooksBody:
    """
    Attributes:
        url (str): HTTPS URL to receive webhook POSTs
        events (list[PostApiV1WebhooksBodyEventsItem]): Event types to subscribe to
        secret (str | Unset): HMAC secret (auto-generated if omitted)
    """

    url: str
    events: list[PostApiV1WebhooksBodyEventsItem]
    secret: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        url = self.url

        events = []
        for events_item_data in self.events:
            events_item = events_item_data.value
            events.append(events_item)

        secret = self.secret

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
            events_item = PostApiV1WebhooksBodyEventsItem(events_item_data)

            events.append(events_item)

        secret = d.pop("secret", UNSET)

        post_api_v1_webhooks_body = cls(
            url=url,
            events=events,
            secret=secret,
        )

        post_api_v1_webhooks_body.additional_properties = d
        return post_api_v1_webhooks_body

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
