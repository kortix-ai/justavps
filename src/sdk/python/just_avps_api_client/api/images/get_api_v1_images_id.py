from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_v1_images_id_response_200 import GetApiV1ImagesIdResponse200
from ...models.get_api_v1_images_id_response_401 import GetApiV1ImagesIdResponse401
from ...models.get_api_v1_images_id_response_404 import GetApiV1ImagesIdResponse404
from ...types import Response


def _get_kwargs(
    id: UUID,
) -> dict[str, Any]:
    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/images/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetApiV1ImagesIdResponse200 | GetApiV1ImagesIdResponse401 | GetApiV1ImagesIdResponse404 | None:
    if response.status_code == 200:
        response_200 = GetApiV1ImagesIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = GetApiV1ImagesIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = GetApiV1ImagesIdResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetApiV1ImagesIdResponse200 | GetApiV1ImagesIdResponse401 | GetApiV1ImagesIdResponse404]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient,
) -> Response[GetApiV1ImagesIdResponse200 | GetApiV1ImagesIdResponse401 | GetApiV1ImagesIdResponse404]:
    """Get an image

     Returns image details including status and provider artifact info.

    Args:
        id (UUID): Image ID

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiV1ImagesIdResponse200 | GetApiV1ImagesIdResponse401 | GetApiV1ImagesIdResponse404]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: UUID,
    *,
    client: AuthenticatedClient,
) -> GetApiV1ImagesIdResponse200 | GetApiV1ImagesIdResponse401 | GetApiV1ImagesIdResponse404 | None:
    """Get an image

     Returns image details including status and provider artifact info.

    Args:
        id (UUID): Image ID

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiV1ImagesIdResponse200 | GetApiV1ImagesIdResponse401 | GetApiV1ImagesIdResponse404
    """

    return sync_detailed(
        id=id,
        client=client,
    ).parsed


async def asyncio_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient,
) -> Response[GetApiV1ImagesIdResponse200 | GetApiV1ImagesIdResponse401 | GetApiV1ImagesIdResponse404]:
    """Get an image

     Returns image details including status and provider artifact info.

    Args:
        id (UUID): Image ID

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiV1ImagesIdResponse200 | GetApiV1ImagesIdResponse401 | GetApiV1ImagesIdResponse404]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: UUID,
    *,
    client: AuthenticatedClient,
) -> GetApiV1ImagesIdResponse200 | GetApiV1ImagesIdResponse401 | GetApiV1ImagesIdResponse404 | None:
    """Get an image

     Returns image details including status and provider artifact info.

    Args:
        id (UUID): Image ID

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiV1ImagesIdResponse200 | GetApiV1ImagesIdResponse401 | GetApiV1ImagesIdResponse404
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
