from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.account_usage_current_period_machines_item import AccountUsageCurrentPeriodMachinesItem


T = TypeVar("T", bound="AccountUsageCurrentPeriod")


@_attrs_define
class AccountUsageCurrentPeriod:
    """
    Attributes:
        machines (list[AccountUsageCurrentPeriodMachinesItem]):
        total_machines (float):
        estimated_cost (float):
    """

    machines: list[AccountUsageCurrentPeriodMachinesItem]
    total_machines: float
    estimated_cost: float

    def to_dict(self) -> dict[str, Any]:
        machines = []
        for machines_item_data in self.machines:
            machines_item = machines_item_data.to_dict()
            machines.append(machines_item)

        total_machines = self.total_machines

        estimated_cost = self.estimated_cost

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "machines": machines,
                "total_machines": total_machines,
                "estimated_cost": estimated_cost,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.account_usage_current_period_machines_item import AccountUsageCurrentPeriodMachinesItem

        d = dict(src_dict)
        machines = []
        _machines = d.pop("machines")
        for machines_item_data in _machines:
            machines_item = AccountUsageCurrentPeriodMachinesItem.from_dict(machines_item_data)

            machines.append(machines_item)

        total_machines = d.pop("total_machines")

        estimated_cost = d.pop("estimated_cost")

        account_usage_current_period = cls(
            machines=machines,
            total_machines=total_machines,
            estimated_cost=estimated_cost,
        )

        return account_usage_current_period
