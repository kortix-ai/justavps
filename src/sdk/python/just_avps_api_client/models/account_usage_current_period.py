from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.account_usage_current_period_machines_item import AccountUsageCurrentPeriodMachinesItem


T = TypeVar("T", bound="AccountUsageCurrentPeriod")


@_attrs_define
class AccountUsageCurrentPeriod:
    """
    Attributes:
        machines (list[AccountUsageCurrentPeriodMachinesItem] | Unset):
        total_machines (int | Unset):
        estimated_cost (float | Unset): Estimated cost for current period (USD)
    """

    machines: list[AccountUsageCurrentPeriodMachinesItem] | Unset = UNSET
    total_machines: int | Unset = UNSET
    estimated_cost: float | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        machines: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.machines, Unset):
            machines = []
            for machines_item_data in self.machines:
                machines_item = machines_item_data.to_dict()
                machines.append(machines_item)

        total_machines = self.total_machines

        estimated_cost = self.estimated_cost

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if machines is not UNSET:
            field_dict["machines"] = machines
        if total_machines is not UNSET:
            field_dict["total_machines"] = total_machines
        if estimated_cost is not UNSET:
            field_dict["estimated_cost"] = estimated_cost

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.account_usage_current_period_machines_item import AccountUsageCurrentPeriodMachinesItem

        d = dict(src_dict)
        _machines = d.pop("machines", UNSET)
        machines: list[AccountUsageCurrentPeriodMachinesItem] | Unset = UNSET
        if _machines is not UNSET:
            machines = []
            for machines_item_data in _machines:
                machines_item = AccountUsageCurrentPeriodMachinesItem.from_dict(machines_item_data)

                machines.append(machines_item)

        total_machines = d.pop("total_machines", UNSET)

        estimated_cost = d.pop("estimated_cost", UNSET)

        account_usage_current_period = cls(
            machines=machines,
            total_machines=total_machines,
            estimated_cost=estimated_cost,
        )

        account_usage_current_period.additional_properties = d
        return account_usage_current_period

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
