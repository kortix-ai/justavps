from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiV1InternalValidateKeyResponse401")


@_attrs_define
class GetApiV1InternalValidateKeyResponse401:
    """
    Attributes:
        valid (bool):
        owner_id (UUID | Unset):
        message (str | Unset):
    """

    valid: bool
    owner_id: UUID | Unset = UNSET
    message: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        valid = self.valid

        owner_id: str | Unset = UNSET
        if not isinstance(self.owner_id, Unset):
            owner_id = str(self.owner_id)

        message = self.message

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        get_api_v1_internal_validate_key_response_401 = cls(
            valid=valid,
            owner_id=owner_id,
            message=message,
        )

        get_api_v1_internal_validate_key_response_401.additional_properties = d
        return get_api_v1_internal_validate_key_response_401

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
