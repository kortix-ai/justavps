from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.image_list_response_images_item import ImageListResponseImagesItem


T = TypeVar("T", bound="ImageListResponse")


@_attrs_define
class ImageListResponse:
    """
    Attributes:
        images (list[ImageListResponseImagesItem]):
    """

    images: list[ImageListResponseImagesItem]

    def to_dict(self) -> dict[str, Any]:
        images = []
        for images_item_data in self.images:
            images_item = images_item_data.to_dict()
            images.append(images_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "images": images,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.image_list_response_images_item import ImageListResponseImagesItem

        d = dict(src_dict)
        images = []
        _images = d.pop("images")
        for images_item_data in _images:
            images_item = ImageListResponseImagesItem.from_dict(images_item_data)

            images.append(images_item)

        image_list_response = cls(
            images=images,
        )

        return image_list_response
