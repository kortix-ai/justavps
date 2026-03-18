from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_v1_server_types_regions_response_200 import GetApiV1ServerTypesRegionsResponse200
from ...models.get_api_v1_server_types_regions_response_400 import GetApiV1ServerTypesRegionsResponse400
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    provider: str | Unset = "cloud",
) -> dict[str, Any]:
    params: dict[str, Any] = {}

    params["provider"] = provider

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/server-types/regions",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetApiV1ServerTypesRegionsResponse200 | GetApiV1ServerTypesRegionsResponse400 | None:
    if response.status_code == 200:
        response_200 = GetApiV1ServerTypesRegionsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiV1ServerTypesRegionsResponse400.from_dict(response.json())

        return response_400

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetApiV1ServerTypesRegionsResponse200 | GetApiV1ServerTypesRegionsResponse400]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    provider: str | Unset = "cloud",
) -> Response[GetApiV1ServerTypesRegionsResponse200 | GetApiV1ServerTypesRegionsResponse400]:
    """List regions

    Args:
        provider (str | Unset): Cloud provider Default: 'cloud'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiV1ServerTypesRegionsResponse200 | GetApiV1ServerTypesRegionsResponse400]
    """

    kwargs = _get_kwargs(
        provider=provider,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    provider: str | Unset = "cloud",
) -> GetApiV1ServerTypesRegionsResponse200 | GetApiV1ServerTypesRegionsResponse400 | None:
    """List regions

    Args:
        provider (str | Unset): Cloud provider Default: 'cloud'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiV1ServerTypesRegionsResponse200 | GetApiV1ServerTypesRegionsResponse400
    """

    return sync_detailed(
        client=client,
        provider=provider,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    provider: str | Unset = "cloud",
) -> Response[GetApiV1ServerTypesRegionsResponse200 | GetApiV1ServerTypesRegionsResponse400]:
    """List regions

    Args:
        provider (str | Unset): Cloud provider Default: 'cloud'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiV1ServerTypesRegionsResponse200 | GetApiV1ServerTypesRegionsResponse400]
    """

    kwargs = _get_kwargs(
        provider=provider,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    provider: str | Unset = "cloud",
) -> GetApiV1ServerTypesRegionsResponse200 | GetApiV1ServerTypesRegionsResponse400 | None:
    """List regions

    Args:
        provider (str | Unset): Cloud provider Default: 'cloud'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiV1ServerTypesRegionsResponse200 | GetApiV1ServerTypesRegionsResponse400
    """

    return (
        await asyncio_detailed(
            client=client,
            provider=provider,
        )
    ).parsed
