from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.machine_list_response_machines_item import MachineListResponseMachinesItem


T = TypeVar("T", bound="MachineListResponse")


@_attrs_define
class MachineListResponse:
    """
    Attributes:
        machines (list[MachineListResponseMachinesItem]):
    """

    machines: list[MachineListResponseMachinesItem]

    def to_dict(self) -> dict[str, Any]:
        machines = []
        for machines_item_data in self.machines:
            machines_item = machines_item_data.to_dict()
            machines.append(machines_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "machines": machines,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.machine_list_response_machines_item import MachineListResponseMachinesItem

        d = dict(src_dict)
        machines = []
        _machines = d.pop("machines")
        for machines_item_data in _machines:
            machines_item = MachineListResponseMachinesItem.from_dict(machines_item_data)

            machines.append(machines_item)

        machine_list_response = cls(
            machines=machines,
        )

        return machine_list_response
