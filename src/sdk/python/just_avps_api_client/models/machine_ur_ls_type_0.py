from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="MachineURLsType0")


@_attrs_define
class MachineURLsType0:
    """
    Attributes:
        vscode (str | Unset):  Example: https://abc123.kortix.cloud.
        pty (str | Unset):  Example: wss://abc123.kortix.cloud/_pty.
    """

    vscode: str | Unset = UNSET
    pty: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        vscode = self.vscode

        pty = self.pty

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if vscode is not UNSET:
            field_dict["vscode"] = vscode
        if pty is not UNSET:
            field_dict["pty"] = pty

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        vscode = d.pop("vscode", UNSET)

        pty = d.pop("pty", UNSET)

        machine_ur_ls_type_0 = cls(
            vscode=vscode,
            pty=pty,
        )

        machine_ur_ls_type_0.additional_properties = d
        return machine_ur_ls_type_0

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
