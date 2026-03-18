from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="BillingSetup")


@_attrs_define
class BillingSetup:
    """
    Attributes:
        checkout_url (str):
    """

    checkout_url: str

    def to_dict(self) -> dict[str, Any]:
        checkout_url = self.checkout_url

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "checkout_url": checkout_url,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        checkout_url = d.pop("checkout_url")

        billing_setup = cls(
            checkout_url=checkout_url,
        )

        return billing_setup
