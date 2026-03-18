from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="CheckoutRequired")


@_attrs_define
class CheckoutRequired:
    """
    Attributes:
        requires_checkout (bool):
        checkout_url (str):
        message (str):
    """

    requires_checkout: bool
    checkout_url: str
    message: str

    def to_dict(self) -> dict[str, Any]:
        requires_checkout = self.requires_checkout

        checkout_url = self.checkout_url

        message = self.message

        field_dict: dict[str, Any] = {}

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

        checkout_required = cls(
            requires_checkout=requires_checkout,
            checkout_url=checkout_url,
            message=message,
        )

        return checkout_required
