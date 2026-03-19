from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_v1_machines_machine_id_toolbox_process_kill_body_signal import (
    PostApiV1MachinesMachineIdToolboxProcessKillBodySignal,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiV1MachinesMachineIdToolboxProcessKillBody")


@_attrs_define
class PostApiV1MachinesMachineIdToolboxProcessKillBody:
    """
    Attributes:
        pid (int): Process ID to kill
        signal (PostApiV1MachinesMachineIdToolboxProcessKillBodySignal | Unset): Signal to send (default: SIGTERM)
    """

    pid: int
    signal: PostApiV1MachinesMachineIdToolboxProcessKillBodySignal | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        pid = self.pid

        signal: str | Unset = UNSET
        if not isinstance(self.signal, Unset):
            signal = self.signal.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "pid": pid,
            }
        )
        if signal is not UNSET:
            field_dict["signal"] = signal

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        pid = d.pop("pid")

        _signal = d.pop("signal", UNSET)
        signal: PostApiV1MachinesMachineIdToolboxProcessKillBodySignal | Unset
        if isinstance(_signal, Unset):
            signal = UNSET
        else:
            signal = PostApiV1MachinesMachineIdToolboxProcessKillBodySignal(_signal)

        post_api_v1_machines_machine_id_toolbox_process_kill_body = cls(
            pid=pid,
            signal=signal,
        )

        post_api_v1_machines_machine_id_toolbox_process_kill_body.additional_properties = d
        return post_api_v1_machines_machine_id_toolbox_process_kill_body

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
