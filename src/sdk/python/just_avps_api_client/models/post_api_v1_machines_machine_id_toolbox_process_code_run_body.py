from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_v1_machines_machine_id_toolbox_process_code_run_body_language import (
    PostApiV1MachinesMachineIdToolboxProcessCodeRunBodyLanguage,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_v1_machines_machine_id_toolbox_process_code_run_body_env import (
        PostApiV1MachinesMachineIdToolboxProcessCodeRunBodyEnv,
    )


T = TypeVar("T", bound="PostApiV1MachinesMachineIdToolboxProcessCodeRunBody")


@_attrs_define
class PostApiV1MachinesMachineIdToolboxProcessCodeRunBody:
    """
    Attributes:
        code (str): Code to execute
        language (PostApiV1MachinesMachineIdToolboxProcessCodeRunBodyLanguage | Unset): Language (auto-detected if
            omitted)
        timeout (int | Unset): Timeout in seconds (default: 30)
        env (PostApiV1MachinesMachineIdToolboxProcessCodeRunBodyEnv | Unset): Additional environment variables
    """

    code: str
    language: PostApiV1MachinesMachineIdToolboxProcessCodeRunBodyLanguage | Unset = UNSET
    timeout: int | Unset = UNSET
    env: PostApiV1MachinesMachineIdToolboxProcessCodeRunBodyEnv | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        code = self.code

        language: str | Unset = UNSET
        if not isinstance(self.language, Unset):
            language = self.language.value

        timeout = self.timeout

        env: dict[str, Any] | Unset = UNSET
        if not isinstance(self.env, Unset):
            env = self.env.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "code": code,
            }
        )
        if language is not UNSET:
            field_dict["language"] = language
        if timeout is not UNSET:
            field_dict["timeout"] = timeout
        if env is not UNSET:
            field_dict["env"] = env

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_v1_machines_machine_id_toolbox_process_code_run_body_env import (
            PostApiV1MachinesMachineIdToolboxProcessCodeRunBodyEnv,
        )

        d = dict(src_dict)
        code = d.pop("code")

        _language = d.pop("language", UNSET)
        language: PostApiV1MachinesMachineIdToolboxProcessCodeRunBodyLanguage | Unset
        if isinstance(_language, Unset):
            language = UNSET
        else:
            language = PostApiV1MachinesMachineIdToolboxProcessCodeRunBodyLanguage(_language)

        timeout = d.pop("timeout", UNSET)

        _env = d.pop("env", UNSET)
        env: PostApiV1MachinesMachineIdToolboxProcessCodeRunBodyEnv | Unset
        if isinstance(_env, Unset):
            env = UNSET
        else:
            env = PostApiV1MachinesMachineIdToolboxProcessCodeRunBodyEnv.from_dict(_env)

        post_api_v1_machines_machine_id_toolbox_process_code_run_body = cls(
            code=code,
            language=language,
            timeout=timeout,
            env=env,
        )

        post_api_v1_machines_machine_id_toolbox_process_code_run_body.additional_properties = d
        return post_api_v1_machines_machine_id_toolbox_process_code_run_body

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
