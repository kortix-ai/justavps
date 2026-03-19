from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_v1_account_billing_setup_response_200 import PostApiV1AccountBillingSetupResponse200
from ...models.post_api_v1_account_billing_setup_response_401 import PostApiV1AccountBillingSetupResponse401
from ...models.post_api_v1_account_billing_setup_response_404 import PostApiV1AccountBillingSetupResponse404
from ...models.post_api_v1_account_billing_setup_response_503 import PostApiV1AccountBillingSetupResponse503
from ...types import Response


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/account/billing/setup",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiV1AccountBillingSetupResponse200
    | PostApiV1AccountBillingSetupResponse401
    | PostApiV1AccountBillingSetupResponse404
    | PostApiV1AccountBillingSetupResponse503
    | None
):
    if response.status_code == 200:
        response_200 = PostApiV1AccountBillingSetupResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = PostApiV1AccountBillingSetupResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = PostApiV1AccountBillingSetupResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 503:
        response_503 = PostApiV1AccountBillingSetupResponse503.from_dict(response.json())

        return response_503

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiV1AccountBillingSetupResponse200
    | PostApiV1AccountBillingSetupResponse401
    | PostApiV1AccountBillingSetupResponse404
    | PostApiV1AccountBillingSetupResponse503
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[
    PostApiV1AccountBillingSetupResponse200
    | PostApiV1AccountBillingSetupResponse401
    | PostApiV1AccountBillingSetupResponse404
    | PostApiV1AccountBillingSetupResponse503
]:
    """Create billing setup session

     Creates a Stripe Checkout Session in setup mode to add a payment method.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1AccountBillingSetupResponse200 | PostApiV1AccountBillingSetupResponse401 | PostApiV1AccountBillingSetupResponse404 | PostApiV1AccountBillingSetupResponse503]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
) -> (
    PostApiV1AccountBillingSetupResponse200
    | PostApiV1AccountBillingSetupResponse401
    | PostApiV1AccountBillingSetupResponse404
    | PostApiV1AccountBillingSetupResponse503
    | None
):
    """Create billing setup session

     Creates a Stripe Checkout Session in setup mode to add a payment method.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1AccountBillingSetupResponse200 | PostApiV1AccountBillingSetupResponse401 | PostApiV1AccountBillingSetupResponse404 | PostApiV1AccountBillingSetupResponse503
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[
    PostApiV1AccountBillingSetupResponse200
    | PostApiV1AccountBillingSetupResponse401
    | PostApiV1AccountBillingSetupResponse404
    | PostApiV1AccountBillingSetupResponse503
]:
    """Create billing setup session

     Creates a Stripe Checkout Session in setup mode to add a payment method.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1AccountBillingSetupResponse200 | PostApiV1AccountBillingSetupResponse401 | PostApiV1AccountBillingSetupResponse404 | PostApiV1AccountBillingSetupResponse503]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> (
    PostApiV1AccountBillingSetupResponse200
    | PostApiV1AccountBillingSetupResponse401
    | PostApiV1AccountBillingSetupResponse404
    | PostApiV1AccountBillingSetupResponse503
    | None
):
    """Create billing setup session

     Creates a Stripe Checkout Session in setup mode to add a payment method.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1AccountBillingSetupResponse200 | PostApiV1AccountBillingSetupResponse401 | PostApiV1AccountBillingSetupResponse404 | PostApiV1AccountBillingSetupResponse503
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
