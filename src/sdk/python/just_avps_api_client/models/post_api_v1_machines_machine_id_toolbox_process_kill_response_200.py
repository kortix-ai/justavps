from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiV1MachinesMachineIdToolboxProcessKillResponse200")


@_attrs_define
class PostApiV1MachinesMachineIdToolboxProcessKillResponse200:
    """
    Attributes:
        killed (bool):
        pid (int):
        signal (str):
    """

    killed: bool
    pid: int
    signal: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        killed = self.killed

        pid = self.pid

        signal = self.signal

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "killed": killed,
                "pid": pid,
                "signal": signal,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        killed = d.pop("killed")

        pid = d.pop("pid")

        signal = d.pop("signal")

        post_api_v1_machines_machine_id_toolbox_process_kill_response_200 = cls(
            killed=killed,
            pid=pid,
            signal=signal,
        )

        post_api_v1_machines_machine_id_toolbox_process_kill_response_200.additional_properties = d
        return post_api_v1_machines_machine_id_toolbox_process_kill_response_200

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
