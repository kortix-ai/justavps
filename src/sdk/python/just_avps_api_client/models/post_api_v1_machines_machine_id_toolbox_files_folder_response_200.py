from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiV1MachinesMachineIdToolboxFilesFolderResponse200")


@_attrs_define
class PostApiV1MachinesMachineIdToolboxFilesFolderResponse200:
    """
    Attributes:
        path (str):
        created (bool):
    """

    path: str
    created: bool
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        path = self.path

        created = self.created

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "path": path,
                "created": created,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        path = d.pop("path")

        created = d.pop("created")

        post_api_v1_machines_machine_id_toolbox_files_folder_response_200 = cls(
            path=path,
            created=created,
        )

        post_api_v1_machines_machine_id_toolbox_files_folder_response_200.additional_properties = d
        return post_api_v1_machines_machine_id_toolbox_files_folder_response_200

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
