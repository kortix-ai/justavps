from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.list_regions_response_200 import ListRegionsResponse200
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    provider: str | Unset = "hetzner",
) -> dict[str, Any]:
    params: dict[str, Any] = {}

    params["provider"] = provider

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/server-types/regions",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Error | ListRegionsResponse200 | None:
    if response.status_code == 200:
        response_200 = ListRegionsResponse200.from_dict(response.json())

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
) -> Response[Error | ListRegionsResponse200]:
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
) -> Response[Error | ListRegionsResponse200]:
    """List regions

     Returns all available regions for a given provider.

    Args:
        provider (str | Unset):  Default: 'hetzner'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | ListRegionsResponse200]
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
    provider: str | Unset = "hetzner",
) -> Error | ListRegionsResponse200 | None:
    """List regions

     Returns all available regions for a given provider.

    Args:
        provider (str | Unset):  Default: 'hetzner'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | ListRegionsResponse200
    """

    return sync_detailed(
        client=client,
        provider=provider,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    provider: str | Unset = "hetzner",
) -> Response[Error | ListRegionsResponse200]:
    """List regions

     Returns all available regions for a given provider.

    Args:
        provider (str | Unset):  Default: 'hetzner'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | ListRegionsResponse200]
    """

    kwargs = _get_kwargs(
        provider=provider,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    provider: str | Unset = "hetzner",
) -> Error | ListRegionsResponse200 | None:
    """List regions

     Returns all available regions for a given provider.

    Args:
        provider (str | Unset):  Default: 'hetzner'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | ListRegionsResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            provider=provider,
        )
    ).parsed
