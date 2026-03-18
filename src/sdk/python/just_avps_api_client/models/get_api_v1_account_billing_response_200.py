from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiV1AccountBillingResponse200")


@_attrs_define
class GetApiV1AccountBillingResponse200:
    """
    Attributes:
        portal_url (None | str):
        has_payment_method (bool):
        message (str | Unset):
    """

    portal_url: None | str
    has_payment_method: bool
    message: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        portal_url: None | str
        portal_url = self.portal_url

        has_payment_method = self.has_payment_method

        message = self.message

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        get_api_v1_account_billing_response_200 = cls(
            portal_url=portal_url,
            has_payment_method=has_payment_method,
            message=message,
        )

        get_api_v1_account_billing_response_200.additional_properties = d
        return get_api_v1_account_billing_response_200

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
