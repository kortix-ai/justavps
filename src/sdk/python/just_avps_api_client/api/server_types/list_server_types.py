from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.server_type_list_response import ServerTypeListResponse
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    provider: str | Unset = "hetzner",
    region: str,
) -> dict[str, Any]:
    params: dict[str, Any] = {}

    params["provider"] = provider

    params["region"] = region

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/server-types",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Error | ServerTypeListResponse | None:
    if response.status_code == 200:
        response_200 = ServerTypeListResponse.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = Error.from_dict(response.json())

        return response_400

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Error | ServerTypeListResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    provider: str | Unset = "hetzner",
    region: str,
) -> Response[Error | ServerTypeListResponse]:
    """List server types

     Returns available server types for a provider + region, with pricing.

    Args:
        provider (str | Unset):  Default: 'hetzner'.
        region (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | ServerTypeListResponse]
    """

    kwargs = _get_kwargs(
        provider=provider,
        region=region,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    provider: str | Unset = "hetzner",
    region: str,
) -> Error | ServerTypeListResponse | None:
    """List server types

     Returns available server types for a provider + region, with pricing.

    Args:
        provider (str | Unset):  Default: 'hetzner'.
        region (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | ServerTypeListResponse
    """

    return sync_detailed(
        client=client,
        provider=provider,
        region=region,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    provider: str | Unset = "hetzner",
    region: str,
) -> Response[Error | ServerTypeListResponse]:
    """List server types

     Returns available server types for a provider + region, with pricing.

    Args:
        provider (str | Unset):  Default: 'hetzner'.
        region (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | ServerTypeListResponse]
    """

    kwargs = _get_kwargs(
        provider=provider,
        region=region,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    provider: str | Unset = "hetzner",
    region: str,
) -> Error | ServerTypeListResponse | None:
    """List server types

     Returns available server types for a provider + region, with pricing.

    Args:
        provider (str | Unset):  Default: 'hetzner'.
        region (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | ServerTypeListResponse
    """

    return (
        await asyncio_detailed(
            client=client,
            provider=provider,
            region=region,
        )
    ).parsed
