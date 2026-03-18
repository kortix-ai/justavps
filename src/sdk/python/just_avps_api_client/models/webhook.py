from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="Webhook")


@_attrs_define
class Webhook:
    """
    Attributes:
        id (UUID):
        url (str):
        events (list[str]):
        active (bool):
        created_at (str):
        secret (str | Unset): Only returned on creation
    """

    id: UUID
    url: str
    events: list[str]
    active: bool
    created_at: str
    secret: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        url = self.url

        events = self.events

        active = self.active

        created_at = self.created_at

        secret = self.secret

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

        created_at = d.pop("created_at")

        secret = d.pop("secret", UNSET)

        webhook = cls(
            id=id,
            url=url,
            events=events,
            active=active,
            created_at=created_at,
            secret=secret,
        )

        return webhook
