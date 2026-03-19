from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_v1_machines_machine_id_toolbox_files_exists_response_200_type_type_1 import (
    GetApiV1MachinesMachineIdToolboxFilesExistsResponse200TypeType1,
)
from ..models.get_api_v1_machines_machine_id_toolbox_files_exists_response_200_type_type_2_type_1 import (
    GetApiV1MachinesMachineIdToolboxFilesExistsResponse200TypeType2Type1,
)
from ..models.get_api_v1_machines_machine_id_toolbox_files_exists_response_200_type_type_3_type_1 import (
    GetApiV1MachinesMachineIdToolboxFilesExistsResponse200TypeType3Type1,
)

T = TypeVar("T", bound="GetApiV1MachinesMachineIdToolboxFilesExistsResponse200")


@_attrs_define
class GetApiV1MachinesMachineIdToolboxFilesExistsResponse200:
    """
    Attributes:
        exists (bool):
        type_ (GetApiV1MachinesMachineIdToolboxFilesExistsResponse200TypeType1 |
            GetApiV1MachinesMachineIdToolboxFilesExistsResponse200TypeType2Type1 |
            GetApiV1MachinesMachineIdToolboxFilesExistsResponse200TypeType3Type1 | None):
    """

    exists: bool
    type_: (
        GetApiV1MachinesMachineIdToolboxFilesExistsResponse200TypeType1
        | GetApiV1MachinesMachineIdToolboxFilesExistsResponse200TypeType2Type1
        | GetApiV1MachinesMachineIdToolboxFilesExistsResponse200TypeType3Type1
        | None
    )
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        exists = self.exists

        type_: None | str
        if isinstance(self.type_, GetApiV1MachinesMachineIdToolboxFilesExistsResponse200TypeType1):
            type_ = self.type_.value
        elif isinstance(self.type_, GetApiV1MachinesMachineIdToolboxFilesExistsResponse200TypeType2Type1):
            type_ = self.type_.value
        elif isinstance(self.type_, GetApiV1MachinesMachineIdToolboxFilesExistsResponse200TypeType3Type1):
            type_ = self.type_.value
        else:
            type_ = self.type_

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "exists": exists,
                "type": type_,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        exists = d.pop("exists")

        def _parse_type_(
            data: object,
        ) -> (
            GetApiV1MachinesMachineIdToolboxFilesExistsResponse200TypeType1
            | GetApiV1MachinesMachineIdToolboxFilesExistsResponse200TypeType2Type1
            | GetApiV1MachinesMachineIdToolboxFilesExistsResponse200TypeType3Type1
            | None
        ):
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                type_type_1 = GetApiV1MachinesMachineIdToolboxFilesExistsResponse200TypeType1(data)

                return type_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                type_type_2_type_1 = GetApiV1MachinesMachineIdToolboxFilesExistsResponse200TypeType2Type1(data)

                return type_type_2_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                type_type_3_type_1 = GetApiV1MachinesMachineIdToolboxFilesExistsResponse200TypeType3Type1(data)

                return type_type_3_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                GetApiV1MachinesMachineIdToolboxFilesExistsResponse200TypeType1
                | GetApiV1MachinesMachineIdToolboxFilesExistsResponse200TypeType2Type1
                | GetApiV1MachinesMachineIdToolboxFilesExistsResponse200TypeType3Type1
                | None,
                data,
            )

        type_ = _parse_type_(d.pop("type"))

        get_api_v1_machines_machine_id_toolbox_files_exists_response_200 = cls(
            exists=exists,
            type_=type_,
        )

        get_api_v1_machines_machine_id_toolbox_files_exists_response_200.additional_properties = d
        return get_api_v1_machines_machine_id_toolbox_files_exists_response_200

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
