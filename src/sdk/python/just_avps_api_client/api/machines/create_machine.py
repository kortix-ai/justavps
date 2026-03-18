from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.checkout_required import CheckoutRequired
from ...models.create_machine import CreateMachine
from ...models.error import Error
from ...models.machine import Machine
from ...types import Response


def _get_kwargs(
    *,
    body: CreateMachine,
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


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> CheckoutRequired | Error | Machine | None:
    if response.status_code == 202:
        response_202 = Machine.from_dict(response.json())

        return response_202

    if response.status_code == 400:
        response_400 = Error.from_dict(response.json())

        return response_400

    if response.status_code == 402:
        response_402 = CheckoutRequired.from_dict(response.json())

        return response_402

    if response.status_code == 404:
        response_404 = Error.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[CheckoutRequired | Error | Machine]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: CreateMachine,
) -> Response[CheckoutRequired | Error | Machine]:
    """Create a machine

     Provisions a new VPS machine. If `image_id` is provided, boots from that image. If omitted, boots
    from Ubuntu 24.04.

    Returns 202 if provisioning starts immediately (user has payment method), or 402 with a
    `checkout_url` if payment is required first.

    Args:
        body (CreateMachine):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[CheckoutRequired | Error | Machine]
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
    body: CreateMachine,
) -> CheckoutRequired | Error | Machine | None:
    """Create a machine

     Provisions a new VPS machine. If `image_id` is provided, boots from that image. If omitted, boots
    from Ubuntu 24.04.

    Returns 202 if provisioning starts immediately (user has payment method), or 402 with a
    `checkout_url` if payment is required first.

    Args:
        body (CreateMachine):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        CheckoutRequired | Error | Machine
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: CreateMachine,
) -> Response[CheckoutRequired | Error | Machine]:
    """Create a machine

     Provisions a new VPS machine. If `image_id` is provided, boots from that image. If omitted, boots
    from Ubuntu 24.04.

    Returns 202 if provisioning starts immediately (user has payment method), or 402 with a
    `checkout_url` if payment is required first.

    Args:
        body (CreateMachine):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[CheckoutRequired | Error | Machine]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: CreateMachine,
) -> CheckoutRequired | Error | Machine | None:
    """Create a machine

     Provisions a new VPS machine. If `image_id` is provided, boots from that image. If omitted, boots
    from Ubuntu 24.04.

    Returns 202 if provisioning starts immediately (user has payment method), or 402 with a
    `checkout_url` if payment is required first.

    Args:
        body (CreateMachine):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        CheckoutRequired | Error | Machine
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
