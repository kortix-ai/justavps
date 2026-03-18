from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiV1MachinesResponse402")


@_attrs_define
class PostApiV1MachinesResponse402:
    """
    Attributes:
        requires_checkout (bool):
        checkout_url (str):
        message (str):
    """

    requires_checkout: bool
    checkout_url: str
    message: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        requires_checkout = self.requires_checkout

        checkout_url = self.checkout_url

        message = self.message

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "requires_checkout": requires_checkout,
                "checkout_url": checkout_url,
                "message": message,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        requires_checkout = d.pop("requires_checkout")

        checkout_url = d.pop("checkout_url")

        message = d.pop("message")

        post_api_v1_machines_response_402 = cls(
            requires_checkout=requires_checkout,
            checkout_url=checkout_url,
            message=message,
        )

        post_api_v1_machines_response_402.additional_properties = d
        return post_api_v1_machines_response_402

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
