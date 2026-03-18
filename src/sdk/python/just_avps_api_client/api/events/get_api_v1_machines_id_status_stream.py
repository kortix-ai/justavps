from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_v1_machines_id_status_stream_response_401 import GetApiV1MachinesIdStatusStreamResponse401
from ...models.get_api_v1_machines_id_status_stream_response_404 import GetApiV1MachinesIdStatusStreamResponse404
from ...types import Response


def _get_kwargs(
    id: UUID,
) -> dict[str, Any]:
    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/machines/{id}/status/stream".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetApiV1MachinesIdStatusStreamResponse401 | GetApiV1MachinesIdStatusStreamResponse404 | str | None:
    if response.status_code == 200:
        response_200 = response.text
        return response_200

    if response.status_code == 401:
        response_401 = GetApiV1MachinesIdStatusStreamResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = GetApiV1MachinesIdStatusStreamResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetApiV1MachinesIdStatusStreamResponse401 | GetApiV1MachinesIdStatusStreamResponse404 | str]:
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
) -> Response[GetApiV1MachinesIdStatusStreamResponse401 | GetApiV1MachinesIdStatusStreamResponse404 | str]:
    """Stream machine status (SSE)

     Opens a Server-Sent Events stream for real-time provisioning updates.

    **Event types:** `status`, `stage`, `done`, `ping`, `error`

    Auto-closes on terminal state or after 10 minutes.

    Args:
        id (UUID): Machine ID

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiV1MachinesIdStatusStreamResponse401 | GetApiV1MachinesIdStatusStreamResponse404 | str]
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
) -> GetApiV1MachinesIdStatusStreamResponse401 | GetApiV1MachinesIdStatusStreamResponse404 | str | None:
    """Stream machine status (SSE)

     Opens a Server-Sent Events stream for real-time provisioning updates.

    **Event types:** `status`, `stage`, `done`, `ping`, `error`

    Auto-closes on terminal state or after 10 minutes.

    Args:
        id (UUID): Machine ID

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiV1MachinesIdStatusStreamResponse401 | GetApiV1MachinesIdStatusStreamResponse404 | str
    """

    return sync_detailed(
        id=id,
        client=client,
    ).parsed


async def asyncio_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient,
) -> Response[GetApiV1MachinesIdStatusStreamResponse401 | GetApiV1MachinesIdStatusStreamResponse404 | str]:
    """Stream machine status (SSE)

     Opens a Server-Sent Events stream for real-time provisioning updates.

    **Event types:** `status`, `stage`, `done`, `ping`, `error`

    Auto-closes on terminal state or after 10 minutes.

    Args:
        id (UUID): Machine ID

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiV1MachinesIdStatusStreamResponse401 | GetApiV1MachinesIdStatusStreamResponse404 | str]
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
) -> GetApiV1MachinesIdStatusStreamResponse401 | GetApiV1MachinesIdStatusStreamResponse404 | str | None:
    """Stream machine status (SSE)

     Opens a Server-Sent Events stream for real-time provisioning updates.

    **Event types:** `status`, `stage`, `done`, `ping`, `error`

    Auto-closes on terminal state or after 10 minutes.

    Args:
        id (UUID): Machine ID

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiV1MachinesIdStatusStreamResponse401 | GetApiV1MachinesIdStatusStreamResponse404 | str
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
