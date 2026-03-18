from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="ResizeResponse")


@_attrs_define
class ResizeResponse:
    """
    Attributes:
        action (Literal['resize']):
        old_type (str):
        new_type (str):
        status (str):
    """

    action: Literal["resize"]
    old_type: str
    new_type: str
    status: str

    def to_dict(self) -> dict[str, Any]:
        action = self.action

        old_type = self.old_type

        new_type = self.new_type

        status = self.status

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "action": action,
                "old_type": old_type,
                "new_type": new_type,
                "status": status,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        action = cast(Literal["resize"], d.pop("action"))
        if action != "resize":
            raise ValueError(f"action must match const 'resize', got '{action}'")

        old_type = d.pop("old_type")

        new_type = d.pop("new_type")

        status = d.pop("status")

        resize_response = cls(
            action=action,
            old_type=old_type,
            new_type=new_type,
            status=status,
        )

        return resize_response
