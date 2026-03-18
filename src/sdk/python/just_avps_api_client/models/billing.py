from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="Billing")


@_attrs_define
class Billing:
    """
    Attributes:
        portal_url (None | str):
        has_payment_method (bool):
        message (str | Unset):
    """

    portal_url: None | str
    has_payment_method: bool
    message: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        portal_url: None | str
        portal_url = self.portal_url

        has_payment_method = self.has_payment_method

        message = self.message

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "portal_url": portal_url,
                "has_payment_method": has_payment_method,
            }
        )
        if message is not UNSET:
            field_dict["message"] = message

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_portal_url(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        portal_url = _parse_portal_url(d.pop("portal_url"))

        has_payment_method = d.pop("has_payment_method")

        message = d.pop("message", UNSET)

        billing = cls(
            portal_url=portal_url,
            has_payment_method=has_payment_method,
            message=message,
        )

        return billing
