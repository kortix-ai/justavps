from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.create_machine_body import CreateMachineBody
from ...models.error import Error
from ...models.machine import Machine
from ...types import Response


def _get_kwargs(
    *,
    body: CreateMachineBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/machines",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Error | Machine | None:
    if response.status_code == 202:
        response_202 = Machine.from_dict(response.json())

        return response_202

    if response.status_code == 400:
        response_400 = Error.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = Error.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = Error.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Error | Machine]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: CreateMachineBody,
) -> Response[Error | Machine]:
    """Create a machine

     Provisions a new VPS machine. Returns immediately with status `provisioning` (HTTP 202).

    If `image_id` is provided, boots from that image. If omitted or null, boots from a fresh Ubuntu
    24.04 install.

    The machine will transition to `ready` once cloud-init completes and the agent sends its first
    heartbeat.

    Use the SSE endpoint `GET /machines/{id}/status/stream` to watch provisioning progress in real-time.

    Args:
        body (CreateMachineBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | Machine]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: CreateMachineBody,
) -> Error | Machine | None:
    """Create a machine

     Provisions a new VPS machine. Returns immediately with status `provisioning` (HTTP 202).

    If `image_id` is provided, boots from that image. If omitted or null, boots from a fresh Ubuntu
    24.04 install.

    The machine will transition to `ready` once cloud-init completes and the agent sends its first
    heartbeat.

    Use the SSE endpoint `GET /machines/{id}/status/stream` to watch provisioning progress in real-time.

    Args:
        body (CreateMachineBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | Machine
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: CreateMachineBody,
) -> Response[Error | Machine]:
    """Create a machine

     Provisions a new VPS machine. Returns immediately with status `provisioning` (HTTP 202).

    If `image_id` is provided, boots from that image. If omitted or null, boots from a fresh Ubuntu
    24.04 install.

    The machine will transition to `ready` once cloud-init completes and the agent sends its first
    heartbeat.

    Use the SSE endpoint `GET /machines/{id}/status/stream` to watch provisioning progress in real-time.

    Args:
        body (CreateMachineBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | Machine]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: CreateMachineBody,
) -> Error | Machine | None:
    """Create a machine

     Provisions a new VPS machine. Returns immediately with status `provisioning` (HTTP 202).

    If `image_id` is provided, boots from that image. If omitted or null, boots from a fresh Ubuntu
    24.04 install.

    The machine will transition to `ready` once cloud-init completes and the agent sends its first
    heartbeat.

    Use the SSE endpoint `GET /machines/{id}/status/stream` to watch provisioning progress in real-time.

    Args:
        body (CreateMachineBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | Machine
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
