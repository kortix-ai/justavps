from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiV1MachinesMachineIdToolboxProcessListResponse200ProcessesItem")


@_attrs_define
class GetApiV1MachinesMachineIdToolboxProcessListResponse200ProcessesItem:
    """
    Attributes:
        pid (int):
        command (str):
        args (str):
        cwd (str | Unset):
        user (str | Unset):
        state (str | Unset):
        memory_rss_bytes (float | Unset):
        started_at (str | Unset):
    """

    pid: int
    command: str
    args: str
    cwd: str | Unset = UNSET
    user: str | Unset = UNSET
    state: str | Unset = UNSET
    memory_rss_bytes: float | Unset = UNSET
    started_at: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        pid = self.pid

        command = self.command

        args = self.args

        cwd = self.cwd

        user = self.user

        state = self.state

        memory_rss_bytes = self.memory_rss_bytes

        started_at = self.started_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "pid": pid,
                "command": command,
                "args": args,
            }
        )
        if cwd is not UNSET:
            field_dict["cwd"] = cwd
        if user is not UNSET:
            field_dict["user"] = user
        if state is not UNSET:
            field_dict["state"] = state
        if memory_rss_bytes is not UNSET:
            field_dict["memory_rss_bytes"] = memory_rss_bytes
        if started_at is not UNSET:
            field_dict["started_at"] = started_at

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        pid = d.pop("pid")

        command = d.pop("command")

        args = d.pop("args")

        cwd = d.pop("cwd", UNSET)

        user = d.pop("user", UNSET)

        state = d.pop("state", UNSET)

        memory_rss_bytes = d.pop("memory_rss_bytes", UNSET)

        started_at = d.pop("started_at", UNSET)

        get_api_v1_machines_machine_id_toolbox_process_list_response_200_processes_item = cls(
            pid=pid,
            command=command,
            args=args,
            cwd=cwd,
            user=user,
            state=state,
            memory_rss_bytes=memory_rss_bytes,
            started_at=started_at,
        )

        get_api_v1_machines_machine_id_toolbox_process_list_response_200_processes_item.additional_properties = d
        return get_api_v1_machines_machine_id_toolbox_process_list_response_200_processes_item

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
