from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_v1_machines_id_resize_response_202_action import PostApiV1MachinesIdResizeResponse202Action

T = TypeVar("T", bound="PostApiV1MachinesIdResizeResponse202")


@_attrs_define
class PostApiV1MachinesIdResizeResponse202:
    """
    Attributes:
        action (PostApiV1MachinesIdResizeResponse202Action):
        old_type (str):
        new_type (str):
        status (str):
    """

    action: PostApiV1MachinesIdResizeResponse202Action
    old_type: str
    new_type: str
    status: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        action = self.action.value

        old_type = self.old_type

        new_type = self.new_type

        status = self.status

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        action = PostApiV1MachinesIdResizeResponse202Action(d.pop("action"))

        old_type = d.pop("old_type")

        new_type = d.pop("new_type")

        status = d.pop("status")

        post_api_v1_machines_id_resize_response_202 = cls(
            action=action,
            old_type=old_type,
            new_type=new_type,
            status=status,
        )

        post_api_v1_machines_id_resize_response_202.additional_properties = d
        return post_api_v1_machines_id_resize_response_202

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
