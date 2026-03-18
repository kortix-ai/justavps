from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.account_usage_current_period import AccountUsageCurrentPeriod


T = TypeVar("T", bound="AccountUsage")


@_attrs_define
class AccountUsage:
    """
    Attributes:
        current_period (AccountUsageCurrentPeriod):
    """

    current_period: AccountUsageCurrentPeriod

    def to_dict(self) -> dict[str, Any]:
        current_period = self.current_period.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "current_period": current_period,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.account_usage_current_period import AccountUsageCurrentPeriod

        d = dict(src_dict)
        current_period = AccountUsageCurrentPeriod.from_dict(d.pop("current_period"))

        account_usage = cls(
            current_period=current_period,
        )

        return account_usage
