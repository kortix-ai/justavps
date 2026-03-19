from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiV1MachinesMachineIdToolboxFilesUploadResponse413")


@_attrs_define
class PostApiV1MachinesMachineIdToolboxFilesUploadResponse413:
    """
    Attributes:
        error (str):
        code (str):
    """

    error: str
    code: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        error = self.error

        code = self.code

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "error": error,
                "code": code,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        error = d.pop("error")

        code = d.pop("code")

        post_api_v1_machines_machine_id_toolbox_files_upload_response_413 = cls(
            error=error,
            code=code,
        )

        post_api_v1_machines_machine_id_toolbox_files_upload_response_413.additional_properties = d
        return post_api_v1_machines_machine_id_toolbox_files_upload_response_413

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
