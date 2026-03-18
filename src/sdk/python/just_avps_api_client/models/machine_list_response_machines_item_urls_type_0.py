from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="MachineListResponseMachinesItemUrlsType0")


@_attrs_define
class MachineListResponseMachinesItemUrlsType0:
    """
    Attributes:
        vscode (str):
        pty (str):
    """

    vscode: str
    pty: str

    def to_dict(self) -> dict[str, Any]:
        vscode = self.vscode

        pty = self.pty

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "vscode": vscode,
                "pty": pty,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        vscode = d.pop("vscode")

        pty = d.pop("pty")

        machine_list_response_machines_item_urls_type_0 = cls(
            vscode=vscode,
            pty=pty,
        )

        return machine_list_response_machines_item_urls_type_0
