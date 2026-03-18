from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ResizeMachine")


@_attrs_define
class ResizeMachine:
    """
    Attributes:
        server_type (str): New server type
    """

    server_type: str

    def to_dict(self) -> dict[str, Any]:
        server_type = self.server_type

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "server_type": server_type,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        server_type = d.pop("server_type")

        resize_machine = cls(
            server_type=server_type,
        )

        return resize_machine
