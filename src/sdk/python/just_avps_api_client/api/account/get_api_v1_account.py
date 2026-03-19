from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_v1_account_response_200 import GetApiV1AccountResponse200
from ...models.get_api_v1_account_response_401 import GetApiV1AccountResponse401
from ...models.get_api_v1_account_response_404 import GetApiV1AccountResponse404
from ...types import Response


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/account",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetApiV1AccountResponse200 | GetApiV1AccountResponse401 | GetApiV1AccountResponse404 | None:
    if response.status_code == 200:
        response_200 = GetApiV1AccountResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = GetApiV1AccountResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = GetApiV1AccountResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetApiV1AccountResponse200 | GetApiV1AccountResponse401 | GetApiV1AccountResponse404]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[GetApiV1AccountResponse200 | GetApiV1AccountResponse401 | GetApiV1AccountResponse404]:
    """Get account info

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiV1AccountResponse200 | GetApiV1AccountResponse401 | GetApiV1AccountResponse404]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
) -> GetApiV1AccountResponse200 | GetApiV1AccountResponse401 | GetApiV1AccountResponse404 | None:
    """Get account info

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiV1AccountResponse200 | GetApiV1AccountResponse401 | GetApiV1AccountResponse404
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[GetApiV1AccountResponse200 | GetApiV1AccountResponse401 | GetApiV1AccountResponse404]:
    """Get account info

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiV1AccountResponse200 | GetApiV1AccountResponse401 | GetApiV1AccountResponse404]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> GetApiV1AccountResponse200 | GetApiV1AccountResponse401 | GetApiV1AccountResponse404 | None:
    """Get account info

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiV1AccountResponse200 | GetApiV1AccountResponse401 | GetApiV1AccountResponse404
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
