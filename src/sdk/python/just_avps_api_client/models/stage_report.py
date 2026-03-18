from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.stage_report_metadata import StageReportMetadata


T = TypeVar("T", bound="StageReport")


@_attrs_define
class StageReport:
    """
    Attributes:
        slug (str):
        machine_token (str):
        stage (str):
        message (str | Unset):
        metadata (StageReportMetadata | Unset):
    """

    slug: str
    machine_token: str
    stage: str
    message: str | Unset = UNSET
    metadata: StageReportMetadata | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        machine_token = self.machine_token

        stage = self.stage

        message = self.message

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}

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
        from ..models.stage_report_metadata import StageReportMetadata

        d = dict(src_dict)
        slug = d.pop("slug")

        machine_token = d.pop("machine_token")

        stage = d.pop("stage")

        message = d.pop("message", UNSET)

        _metadata = d.pop("metadata", UNSET)
        metadata: StageReportMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = StageReportMetadata.from_dict(_metadata)

        stage_report = cls(
            slug=slug,
            machine_token=machine_token,
            stage=stage,
            message=message,
            metadata=metadata,
        )

        return stage_report
