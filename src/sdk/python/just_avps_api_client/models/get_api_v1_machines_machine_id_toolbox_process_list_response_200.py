from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_v1_machines_machine_id_toolbox_process_list_response_200_processes_item import (
        GetApiV1MachinesMachineIdToolboxProcessListResponse200ProcessesItem,
    )


T = TypeVar("T", bound="GetApiV1MachinesMachineIdToolboxProcessListResponse200")


@_attrs_define
class GetApiV1MachinesMachineIdToolboxProcessListResponse200:
    """
    Attributes:
        processes (list[GetApiV1MachinesMachineIdToolboxProcessListResponse200ProcessesItem]):
    """

    processes: list[GetApiV1MachinesMachineIdToolboxProcessListResponse200ProcessesItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        processes = []
        for processes_item_data in self.processes:
            processes_item = processes_item_data.to_dict()
            processes.append(processes_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "processes": processes,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_v1_machines_machine_id_toolbox_process_list_response_200_processes_item import (
            GetApiV1MachinesMachineIdToolboxProcessListResponse200ProcessesItem,
        )

        d = dict(src_dict)
        processes = []
        _processes = d.pop("processes")
        for processes_item_data in _processes:
            processes_item = GetApiV1MachinesMachineIdToolboxProcessListResponse200ProcessesItem.from_dict(
                processes_item_data
            )

            processes.append(processes_item)

        get_api_v1_machines_machine_id_toolbox_process_list_response_200 = cls(
            processes=processes,
        )

        get_api_v1_machines_machine_id_toolbox_process_list_response_200.additional_properties = d
        return get_api_v1_machines_machine_id_toolbox_process_list_response_200

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
