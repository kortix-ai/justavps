from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.resize_machine_body import ResizeMachineBody
from ...models.resize_machine_response_202 import ResizeMachineResponse202
from ...types import Response


def _get_kwargs(
    id: UUID,
    *,
    body: ResizeMachineBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/machines/{id}/resize".format(
            id=quote(str(id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Error | ResizeMachineResponse202 | None:
    if response.status_code == 202:
        response_202 = ResizeMachineResponse202.from_dict(response.json())

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


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Error | ResizeMachineResponse202]:
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
    body: ResizeMachineBody,
) -> Response[Error | ResizeMachineResponse202]:
    """Resize a machine

     Changes the machine to a different server type. The machine will reboot during the resize (~30s
    downtime).

    **Constraints:**
    - Disk can only grow (no downsizing)
    - Same architecture required (x86 ↔ ARM requires a new machine)
    - Billing is updated with prorated pricing

    Args:
        id (UUID):
        body (ResizeMachineBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | ResizeMachineResponse202]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: UUID,
    *,
    client: AuthenticatedClient,
    body: ResizeMachineBody,
) -> Error | ResizeMachineResponse202 | None:
    """Resize a machine

     Changes the machine to a different server type. The machine will reboot during the resize (~30s
    downtime).

    **Constraints:**
    - Disk can only grow (no downsizing)
    - Same architecture required (x86 ↔ ARM requires a new machine)
    - Billing is updated with prorated pricing

    Args:
        id (UUID):
        body (ResizeMachineBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | ResizeMachineResponse202
    """

    return sync_detailed(
        id=id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient,
    body: ResizeMachineBody,
) -> Response[Error | ResizeMachineResponse202]:
    """Resize a machine

     Changes the machine to a different server type. The machine will reboot during the resize (~30s
    downtime).

    **Constraints:**
    - Disk can only grow (no downsizing)
    - Same architecture required (x86 ↔ ARM requires a new machine)
    - Billing is updated with prorated pricing

    Args:
        id (UUID):
        body (ResizeMachineBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | ResizeMachineResponse202]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: UUID,
    *,
    client: AuthenticatedClient,
    body: ResizeMachineBody,
) -> Error | ResizeMachineResponse202 | None:
    """Resize a machine

     Changes the machine to a different server type. The machine will reboot during the resize (~30s
    downtime).

    **Constraints:**
    - Disk can only grow (no downsizing)
    - Same architecture required (x86 ↔ ARM requires a new machine)
    - Billing is updated with prorated pricing

    Args:
        id (UUID):
        body (ResizeMachineBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | ResizeMachineResponse202
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
