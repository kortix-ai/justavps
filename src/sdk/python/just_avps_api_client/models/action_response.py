from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ActionResponse")


@_attrs_define
class ActionResponse:
    """
    Attributes:
        action (str):
        status (str):
    """

    action: str
    status: str

    def to_dict(self) -> dict[str, Any]:
        action = self.action

        status = self.status

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "action": action,
                "status": status,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        action = d.pop("action")

        status = d.pop("status")

        action_response = cls(
            action=action,
            status=status,
        )

        return action_response
