from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..types import UNSET, Unset

T = TypeVar("T", bound="Webhook")


@_attrs_define
class Webhook:
    """
    Attributes:
        id (UUID):
        url (str):  Example: https://example.com/webhooks/justavps.
        events (list[str]):  Example: ['machine.status_changed', 'machine.stage_changed'].
        active (bool):
        created_at (datetime.datetime):
        secret (str | Unset): HMAC secret — only returned on creation Example: whsec_abc123....
    """

    id: UUID
    url: str
    events: list[str]
    active: bool
    created_at: datetime.datetime
    secret: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        url = self.url

        events = self.events

        active = self.active

        created_at = self.created_at.isoformat()

        secret = self.secret

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "url": url,
                "events": events,
                "active": active,
                "created_at": created_at,
            }
        )
        if secret is not UNSET:
            field_dict["secret"] = secret

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = UUID(d.pop("id"))

        url = d.pop("url")

        events = cast(list[str], d.pop("events"))

        active = d.pop("active")

        created_at = isoparse(d.pop("created_at"))

        secret = d.pop("secret", UNSET)

        webhook = cls(
            id=id,
            url=url,
            events=events,
            active=active,
            created_at=created_at,
            secret=secret,
        )

        webhook.additional_properties = d
        return webhook

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
