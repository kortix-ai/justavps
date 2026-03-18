from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.validate_api_key_response_200 import ValidateAPIKeyResponse200
from ...models.validate_api_key_response_401 import ValidateAPIKeyResponse401
from ...models.validate_api_key_response_403 import ValidateAPIKeyResponse403
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    key: str,
    machine_slug: str | Unset = UNSET,
) -> dict[str, Any]:
    params: dict[str, Any] = {}

    params["key"] = key

    params["machine_slug"] = machine_slug

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/internal/validate-key",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ValidateAPIKeyResponse200 | ValidateAPIKeyResponse401 | ValidateAPIKeyResponse403 | None:
    if response.status_code == 200:
        response_200 = ValidateAPIKeyResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = ValidateAPIKeyResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = ValidateAPIKeyResponse403.from_dict(response.json())

        return response_403

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ValidateAPIKeyResponse200 | ValidateAPIKeyResponse401 | ValidateAPIKeyResponse403]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    key: str,
    machine_slug: str | Unset = UNSET,
) -> Response[ValidateAPIKeyResponse200 | ValidateAPIKeyResponse401 | ValidateAPIKeyResponse403]:
    """Validate API key

     Called by the Cloudflare Worker to validate API keys at the edge. IP-restricted.

    Args:
        key (str):
        machine_slug (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ValidateAPIKeyResponse200 | ValidateAPIKeyResponse401 | ValidateAPIKeyResponse403]
    """

    kwargs = _get_kwargs(
        key=key,
        machine_slug=machine_slug,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    key: str,
    machine_slug: str | Unset = UNSET,
) -> ValidateAPIKeyResponse200 | ValidateAPIKeyResponse401 | ValidateAPIKeyResponse403 | None:
    """Validate API key

     Called by the Cloudflare Worker to validate API keys at the edge. IP-restricted.

    Args:
        key (str):
        machine_slug (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ValidateAPIKeyResponse200 | ValidateAPIKeyResponse401 | ValidateAPIKeyResponse403
    """

    return sync_detailed(
        client=client,
        key=key,
        machine_slug=machine_slug,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    key: str,
    machine_slug: str | Unset = UNSET,
) -> Response[ValidateAPIKeyResponse200 | ValidateAPIKeyResponse401 | ValidateAPIKeyResponse403]:
    """Validate API key

     Called by the Cloudflare Worker to validate API keys at the edge. IP-restricted.

    Args:
        key (str):
        machine_slug (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ValidateAPIKeyResponse200 | ValidateAPIKeyResponse401 | ValidateAPIKeyResponse403]
    """

    kwargs = _get_kwargs(
        key=key,
        machine_slug=machine_slug,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    key: str,
    machine_slug: str | Unset = UNSET,
) -> ValidateAPIKeyResponse200 | ValidateAPIKeyResponse401 | ValidateAPIKeyResponse403 | None:
    """Validate API key

     Called by the Cloudflare Worker to validate API keys at the edge. IP-restricted.

    Args:
        key (str):
        machine_slug (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ValidateAPIKeyResponse200 | ValidateAPIKeyResponse401 | ValidateAPIKeyResponse403
    """

    return (
        await asyncio_detailed(
            client=client,
            key=key,
            machine_slug=machine_slug,
        )
    ).parsed
