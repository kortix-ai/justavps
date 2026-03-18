from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="Error")


@_attrs_define
class Error:
    """
    Attributes:
        error (bool):  Default: True.
        message (str):
        status (float):
    """

    message: str
    status: float
    error: bool = True

    def to_dict(self) -> dict[str, Any]:
        error = self.error

        message = self.message

        status = self.status

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "error": error,
                "message": message,
                "status": status,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        error = d.pop("error")

        message = d.pop("message")

        status = d.pop("status")

        error = cls(
            error=error,
            message=message,
            status=status,
        )

        return error
