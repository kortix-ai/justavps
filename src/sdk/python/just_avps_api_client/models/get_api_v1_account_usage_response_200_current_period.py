from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_v1_account_usage_response_200_current_period_machines_item import (
        GetApiV1AccountUsageResponse200CurrentPeriodMachinesItem,
    )


T = TypeVar("T", bound="GetApiV1AccountUsageResponse200CurrentPeriod")


@_attrs_define
class GetApiV1AccountUsageResponse200CurrentPeriod:
    """
    Attributes:
        machines (list[GetApiV1AccountUsageResponse200CurrentPeriodMachinesItem]):
        total_machines (float):
        estimated_cost (float):
    """

    machines: list[GetApiV1AccountUsageResponse200CurrentPeriodMachinesItem]
    total_machines: float
    estimated_cost: float
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        machines = []
        for machines_item_data in self.machines:
            machines_item = machines_item_data.to_dict()
            machines.append(machines_item)

        total_machines = self.total_machines

        estimated_cost = self.estimated_cost

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        from ..models.get_api_v1_account_usage_response_200_current_period_machines_item import (
            GetApiV1AccountUsageResponse200CurrentPeriodMachinesItem,
        )

        d = dict(src_dict)
        machines = []
        _machines = d.pop("machines")
        for machines_item_data in _machines:
            machines_item = GetApiV1AccountUsageResponse200CurrentPeriodMachinesItem.from_dict(machines_item_data)

            machines.append(machines_item)

        total_machines = d.pop("total_machines")

        estimated_cost = d.pop("estimated_cost")

        get_api_v1_account_usage_response_200_current_period = cls(
            machines=machines,
            total_machines=total_machines,
            estimated_cost=estimated_cost,
        )

        get_api_v1_account_usage_response_200_current_period.additional_properties = d
        return get_api_v1_account_usage_response_200_current_period

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
