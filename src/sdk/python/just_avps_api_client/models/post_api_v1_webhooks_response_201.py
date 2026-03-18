from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiV1WebhooksResponse201")


@_attrs_define
class PostApiV1WebhooksResponse201:
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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        url = self.url

        events = self.events

        active = self.active

        created_at = self.created_at

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

        created_at = d.pop("created_at")

        secret = d.pop("secret", UNSET)

        post_api_v1_webhooks_response_201 = cls(
            id=id,
            url=url,
            events=events,
            active=active,
            created_at=created_at,
            secret=secret,
        )

        post_api_v1_webhooks_response_201.additional_properties = d
        return post_api_v1_webhooks_response_201

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
