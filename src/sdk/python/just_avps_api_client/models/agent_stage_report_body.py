from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.agent_stage_report_body_metadata import AgentStageReportBodyMetadata


T = TypeVar("T", bound="AgentStageReportBody")


@_attrs_define
class AgentStageReportBody:
    """
    Attributes:
        slug (str):
        machine_token (str):
        stage (str):  Example: docker_pulling.
        message (str | Unset):
        metadata (AgentStageReportBodyMetadata | Unset):
    """

    slug: str
    machine_token: str
    stage: str
    message: str | Unset = UNSET
    metadata: AgentStageReportBodyMetadata | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        machine_token = self.machine_token

        stage = self.stage

        message = self.message

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "slug": slug,
                "machine_token": machine_token,
                "stage": stage,
            }
        )
        if message is not UNSET:
            field_dict["message"] = message
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.agent_stage_report_body_metadata import AgentStageReportBodyMetadata

        d = dict(src_dict)
        slug = d.pop("slug")

        machine_token = d.pop("machine_token")

        stage = d.pop("stage")

        message = d.pop("message", UNSET)

        _metadata = d.pop("metadata", UNSET)
        metadata: AgentStageReportBodyMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = AgentStageReportBodyMetadata.from_dict(_metadata)

        agent_stage_report_body = cls(
            slug=slug,
            machine_token=machine_token,
            stage=stage,
            message=message,
            metadata=metadata,
        )

        agent_stage_report_body.additional_properties = d
        return agent_stage_report_body

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
