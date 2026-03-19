from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetApiV1MachinesMachineIdToolboxFilesFindResponse200MatchesItem")


@_attrs_define
class GetApiV1MachinesMachineIdToolboxFilesFindResponse200MatchesItem:
    """
    Attributes:
        file (str):
        line (float):
        content (str):
    """

    file: str
    line: float
    content: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        file = self.file

        line = self.line

        content = self.content

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "file": file,
                "line": line,
                "content": content,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        file = d.pop("file")

        line = d.pop("line")

        content = d.pop("content")

        get_api_v1_machines_machine_id_toolbox_files_find_response_200_matches_item = cls(
            file=file,
            line=line,
            content=content,
        )

        get_api_v1_machines_machine_id_toolbox_files_find_response_200_matches_item.additional_properties = d
        return get_api_v1_machines_machine_id_toolbox_files_find_response_200_matches_item

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
