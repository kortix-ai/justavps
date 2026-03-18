from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_v1_machines_response_200_machines_item import GetApiV1MachinesResponse200MachinesItem


T = TypeVar("T", bound="GetApiV1MachinesResponse200")


@_attrs_define
class GetApiV1MachinesResponse200:
    """
    Attributes:
        machines (list[GetApiV1MachinesResponse200MachinesItem]):
    """

    machines: list[GetApiV1MachinesResponse200MachinesItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        machines = []
        for machines_item_data in self.machines:
            machines_item = machines_item_data.to_dict()
            machines.append(machines_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "machines": machines,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_v1_machines_response_200_machines_item import GetApiV1MachinesResponse200MachinesItem

        d = dict(src_dict)
        machines = []
        _machines = d.pop("machines")
        for machines_item_data in _machines:
            machines_item = GetApiV1MachinesResponse200MachinesItem.from_dict(machines_item_data)

            machines.append(machines_item)

        get_api_v1_machines_response_200 = cls(
            machines=machines,
        )

        get_api_v1_machines_response_200.additional_properties = d
        return get_api_v1_machines_response_200

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
