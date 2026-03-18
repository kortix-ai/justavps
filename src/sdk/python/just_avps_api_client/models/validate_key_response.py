from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ValidateKeyResponse")


@_attrs_define
class ValidateKeyResponse:
    """
    Attributes:
        valid (bool):
        owner_id (UUID | Unset):
        message (str | Unset):
    """

    valid: bool
    owner_id: UUID | Unset = UNSET
    message: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        valid = self.valid

        owner_id: str | Unset = UNSET
        if not isinstance(self.owner_id, Unset):
            owner_id = str(self.owner_id)

        message = self.message

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "valid": valid,
            }
        )
        if owner_id is not UNSET:
            field_dict["owner_id"] = owner_id
        if message is not UNSET:
            field_dict["message"] = message

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        valid = d.pop("valid")

        _owner_id = d.pop("owner_id", UNSET)
        owner_id: UUID | Unset
        if isinstance(_owner_id, Unset):
            owner_id = UNSET
        else:
            owner_id = UUID(_owner_id)

        message = d.pop("message", UNSET)

        validate_key_response = cls(
            valid=valid,
            owner_id=owner_id,
            message=message,
        )

        return validate_key_response
