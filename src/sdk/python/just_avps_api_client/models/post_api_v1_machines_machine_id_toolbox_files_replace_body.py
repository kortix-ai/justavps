from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiV1MachinesMachineIdToolboxFilesReplaceBody")


@_attrs_define
class PostApiV1MachinesMachineIdToolboxFilesReplaceBody:
    """
    Attributes:
        files (list[str]): Absolute file paths to search
        pattern (str): Regex pattern to match
        new_value (str): Replacement string
    """

    files: list[str]
    pattern: str
    new_value: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        files = self.files

        pattern = self.pattern

        new_value = self.new_value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "files": files,
                "pattern": pattern,
                "new_value": new_value,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        files = cast(list[str], d.pop("files"))

        pattern = d.pop("pattern")

        new_value = d.pop("new_value")

        post_api_v1_machines_machine_id_toolbox_files_replace_body = cls(
            files=files,
            pattern=pattern,
            new_value=new_value,
        )

        post_api_v1_machines_machine_id_toolbox_files_replace_body.additional_properties = d
        return post_api_v1_machines_machine_id_toolbox_files_replace_body

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
