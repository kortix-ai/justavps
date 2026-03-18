from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="ResizeMachineResponse202")


@_attrs_define
class ResizeMachineResponse202:
    """
    Attributes:
        action (str | Unset):  Example: resize.
        old_type (str | Unset):  Example: cpx22.
        new_type (str | Unset):  Example: cpx32.
        status (str | Unset):  Example: initiated.
    """

    action: str | Unset = UNSET
    old_type: str | Unset = UNSET
    new_type: str | Unset = UNSET
    status: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        action = self.action

        old_type = self.old_type

        new_type = self.new_type

        status = self.status

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if action is not UNSET:
            field_dict["action"] = action
        if old_type is not UNSET:
            field_dict["old_type"] = old_type
        if new_type is not UNSET:
            field_dict["new_type"] = new_type
        if status is not UNSET:
            field_dict["status"] = status

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        action = d.pop("action", UNSET)

        old_type = d.pop("old_type", UNSET)

        new_type = d.pop("new_type", UNSET)

        status = d.pop("status", UNSET)

        resize_machine_response_202 = cls(
            action=action,
            old_type=old_type,
            new_type=new_type,
            status=status,
        )

        resize_machine_response_202.additional_properties = d
        return resize_machine_response_202

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
