from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_v1_machines_machine_id_toolbox_files_response_200_entries_item_type import (
    GetApiV1MachinesMachineIdToolboxFilesResponse200EntriesItemType,
)

T = TypeVar("T", bound="GetApiV1MachinesMachineIdToolboxFilesResponse200EntriesItem")


@_attrs_define
class GetApiV1MachinesMachineIdToolboxFilesResponse200EntriesItem:
    """
    Attributes:
        name (str):
        path (str):
        type_ (GetApiV1MachinesMachineIdToolboxFilesResponse200EntriesItemType):
        size (float):
        mode (str): Human-readable mode string, e.g. "-rw-r--r--"
        mode_bits (str): Octal permission bits, e.g. "644"
        owner (str):
        group (str):
        mod_time (str):
        symlink_target (None | str):
    """

    name: str
    path: str
    type_: GetApiV1MachinesMachineIdToolboxFilesResponse200EntriesItemType
    size: float
    mode: str
    mode_bits: str
    owner: str
    group: str
    mod_time: str
    symlink_target: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        path = self.path

        type_ = self.type_.value

        size = self.size

        mode = self.mode

        mode_bits = self.mode_bits

        owner = self.owner

        group = self.group

        mod_time = self.mod_time

        symlink_target: None | str
        symlink_target = self.symlink_target

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "path": path,
                "type": type_,
                "size": size,
                "mode": mode,
                "mode_bits": mode_bits,
                "owner": owner,
                "group": group,
                "mod_time": mod_time,
                "symlink_target": symlink_target,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        path = d.pop("path")

        type_ = GetApiV1MachinesMachineIdToolboxFilesResponse200EntriesItemType(d.pop("type"))

        size = d.pop("size")

        mode = d.pop("mode")

        mode_bits = d.pop("mode_bits")

        owner = d.pop("owner")

        group = d.pop("group")

        mod_time = d.pop("mod_time")

        def _parse_symlink_target(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        symlink_target = _parse_symlink_target(d.pop("symlink_target"))

        get_api_v1_machines_machine_id_toolbox_files_response_200_entries_item = cls(
            name=name,
            path=path,
            type_=type_,
            size=size,
            mode=mode,
            mode_bits=mode_bits,
            owner=owner,
            group=group,
            mod_time=mod_time,
            symlink_target=symlink_target,
        )

        get_api_v1_machines_machine_id_toolbox_files_response_200_entries_item.additional_properties = d
        return get_api_v1_machines_machine_id_toolbox_files_response_200_entries_item

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
