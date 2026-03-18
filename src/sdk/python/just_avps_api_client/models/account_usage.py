from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.account_usage_current_period import AccountUsageCurrentPeriod


T = TypeVar("T", bound="AccountUsage")


@_attrs_define
class AccountUsage:
    """
    Attributes:
        current_period (AccountUsageCurrentPeriod | Unset):
    """

    current_period: AccountUsageCurrentPeriod | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        current_period: dict[str, Any] | Unset = UNSET
        if not isinstance(self.current_period, Unset):
            current_period = self.current_period.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if current_period is not UNSET:
            field_dict["current_period"] = current_period

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.account_usage_current_period import AccountUsageCurrentPeriod

        d = dict(src_dict)
        _current_period = d.pop("current_period", UNSET)
        current_period: AccountUsageCurrentPeriod | Unset
        if isinstance(_current_period, Unset):
            current_period = UNSET
        else:
            current_period = AccountUsageCurrentPeriod.from_dict(_current_period)

        account_usage = cls(
            current_period=current_period,
        )

        account_usage.additional_properties = d
        return account_usage

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
