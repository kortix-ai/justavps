from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_v1_machines_body_env_vars import PostApiV1MachinesBodyEnvVars


T = TypeVar("T", bound="PostApiV1MachinesBody")


@_attrs_define
class PostApiV1MachinesBody:
    """
    Attributes:
        server_type (str): Server type (e.g. "cpx32")
        region (str): Region (e.g. "hel1", "hil")
        image_id (None | Unset | UUID): Image to boot from. Null = Ubuntu 24.04
        provider (str | Unset): Cloud provider Default: 'cloud'.
        name (str | Unset): Human-readable name
        env_vars (PostApiV1MachinesBodyEnvVars | Unset): Extra environment variables written to /etc/justavps/env on the
            machine
        docker_image (str | Unset): Docker image to run on boot (e.g. "myapp:latest")
        entrypoint (str | Unset): Entrypoint for the Docker container
        ssh_key_ids (list[UUID] | Unset): IDs of user SSH keys to add to the machine. Auto-generated key is always
            included.
    """

    server_type: str
    region: str
    image_id: None | Unset | UUID = UNSET
    provider: str | Unset = "cloud"
    name: str | Unset = UNSET
    env_vars: PostApiV1MachinesBodyEnvVars | Unset = UNSET
    docker_image: str | Unset = UNSET
    entrypoint: str | Unset = UNSET
    ssh_key_ids: list[UUID] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        server_type = self.server_type

        region = self.region

        image_id: None | str | Unset
        if isinstance(self.image_id, Unset):
            image_id = UNSET
        elif isinstance(self.image_id, UUID):
            image_id = str(self.image_id)
        else:
            image_id = self.image_id

        provider = self.provider

        name = self.name

        env_vars: dict[str, Any] | Unset = UNSET
        if not isinstance(self.env_vars, Unset):
            env_vars = self.env_vars.to_dict()

        docker_image = self.docker_image

        entrypoint = self.entrypoint

        ssh_key_ids: list[str] | Unset = UNSET
        if not isinstance(self.ssh_key_ids, Unset):
            ssh_key_ids = []
            for ssh_key_ids_item_data in self.ssh_key_ids:
                ssh_key_ids_item = str(ssh_key_ids_item_data)
                ssh_key_ids.append(ssh_key_ids_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "server_type": server_type,
                "region": region,
            }
        )
        if image_id is not UNSET:
            field_dict["image_id"] = image_id
        if provider is not UNSET:
            field_dict["provider"] = provider
        if name is not UNSET:
            field_dict["name"] = name
        if env_vars is not UNSET:
            field_dict["env_vars"] = env_vars
        if docker_image is not UNSET:
            field_dict["docker_image"] = docker_image
        if entrypoint is not UNSET:
            field_dict["entrypoint"] = entrypoint
        if ssh_key_ids is not UNSET:
            field_dict["ssh_key_ids"] = ssh_key_ids

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_v1_machines_body_env_vars import PostApiV1MachinesBodyEnvVars

        d = dict(src_dict)
        server_type = d.pop("server_type")

        region = d.pop("region")

        def _parse_image_id(data: object) -> None | Unset | UUID:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                image_id_type_0 = UUID(data)

                return image_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | Unset | UUID, data)

        image_id = _parse_image_id(d.pop("image_id", UNSET))

        provider = d.pop("provider", UNSET)

        name = d.pop("name", UNSET)

        _env_vars = d.pop("env_vars", UNSET)
        env_vars: PostApiV1MachinesBodyEnvVars | Unset
        if isinstance(_env_vars, Unset):
            env_vars = UNSET
        else:
            env_vars = PostApiV1MachinesBodyEnvVars.from_dict(_env_vars)

        docker_image = d.pop("docker_image", UNSET)

        entrypoint = d.pop("entrypoint", UNSET)

        _ssh_key_ids = d.pop("ssh_key_ids", UNSET)
        ssh_key_ids: list[UUID] | Unset = UNSET
        if _ssh_key_ids is not UNSET:
            ssh_key_ids = []
            for ssh_key_ids_item_data in _ssh_key_ids:
                ssh_key_ids_item = UUID(ssh_key_ids_item_data)

                ssh_key_ids.append(ssh_key_ids_item)

        post_api_v1_machines_body = cls(
            server_type=server_type,
            region=region,
            image_id=image_id,
            provider=provider,
            name=name,
            env_vars=env_vars,
            docker_image=docker_image,
            entrypoint=entrypoint,
            ssh_key_ids=ssh_key_ids,
        )

        post_api_v1_machines_body.additional_properties = d
        return post_api_v1_machines_body

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
