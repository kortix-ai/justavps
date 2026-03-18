from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="Ack")


@_attrs_define
class Ack:
    """
    Attributes:
        ack (bool):
    """

    ack: bool

    def to_dict(self) -> dict[str, Any]:
        ack = self.ack

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "ack": ack,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        ack = d.pop("ack")

        ack = cls(
            ack=ack,
        )

        return ack
