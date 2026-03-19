from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_v1_machines_machine_id_toolbox_process_execute_stream_body_env import (
        PostApiV1MachinesMachineIdToolboxProcessExecuteStreamBodyEnv,
    )


T = TypeVar("T", bound="PostApiV1MachinesMachineIdToolboxProcessExecuteStreamBody")


@_attrs_define
class PostApiV1MachinesMachineIdToolboxProcessExecuteStreamBody:
    """
    Attributes:
        command (str): Shell command to execute
        cwd (str | Unset): Working directory (default: /root)
        timeout (int | Unset): Timeout in seconds (default: 60)
        env (PostApiV1MachinesMachineIdToolboxProcessExecuteStreamBodyEnv | Unset): Additional environment variables
        user (str | Unset): User to run as (default: root)
    """

    command: str
    cwd: str | Unset = UNSET
    timeout: int | Unset = UNSET
    env: PostApiV1MachinesMachineIdToolboxProcessExecuteStreamBodyEnv | Unset = UNSET
    user: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        command = self.command

        cwd = self.cwd

        timeout = self.timeout

        env: dict[str, Any] | Unset = UNSET
        if not isinstance(self.env, Unset):
            env = self.env.to_dict()

        user = self.user

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "command": command,
            }
        )
        if cwd is not UNSET:
            field_dict["cwd"] = cwd
        if timeout is not UNSET:
            field_dict["timeout"] = timeout
        if env is not UNSET:
            field_dict["env"] = env
        if user is not UNSET:
            field_dict["user"] = user

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_v1_machines_machine_id_toolbox_process_execute_stream_body_env import (
            PostApiV1MachinesMachineIdToolboxProcessExecuteStreamBodyEnv,
        )

        d = dict(src_dict)
        command = d.pop("command")

        cwd = d.pop("cwd", UNSET)

        timeout = d.pop("timeout", UNSET)

        _env = d.pop("env", UNSET)
        env: PostApiV1MachinesMachineIdToolboxProcessExecuteStreamBodyEnv | Unset
        if isinstance(_env, Unset):
            env = UNSET
        else:
            env = PostApiV1MachinesMachineIdToolboxProcessExecuteStreamBodyEnv.from_dict(_env)

        user = d.pop("user", UNSET)

        post_api_v1_machines_machine_id_toolbox_process_execute_stream_body = cls(
            command=command,
            cwd=cwd,
            timeout=timeout,
            env=env,
            user=user,
        )

        post_api_v1_machines_machine_id_toolbox_process_execute_stream_body.additional_properties = d
        return post_api_v1_machines_machine_id_toolbox_process_execute_stream_body

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
