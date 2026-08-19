"""Internal service authentication.

Backend-to-AI traffic must use the shared internal credential — never a
recruiter JWT — and both a missing and a wrong token must be rejected.
"""

from __future__ import annotations

import pytest

INTERNAL_ROUTES = [
    ("/internal/search", {"organizationId": "org-a", "query": "kubernetes"}),
    ("/internal/rerank", {"query": "kubernetes", "hits": []}),
    ("/internal/documents/delete", {"organizationId": "org-a", "documentId": "d1"}),
]


@pytest.mark.parametrize("path,payload", INTERNAL_ROUTES)
def test_missing_token_is_rejected(client, path, payload):
    response = client.post(path, json=payload)
    assert response.status_code == 401


@pytest.mark.parametrize("path,payload", INTERNAL_ROUTES)
def test_wrong_token_is_rejected(client, path, payload):
    response = client.post(
        path, json=payload, headers={"X-Internal-Service-Token": "wrong-token"}
    )
    assert response.status_code == 401


def test_process_endpoint_requires_token(client):
    response = client.post(
        "/internal/documents/process",
        files={"file": ("cv.pdf", b"%PDF-1.4", "application/pdf")},
        data={"documentId": "d1", "organizationId": "org-a"},
    )
    assert response.status_code == 401


def test_error_response_does_not_echo_the_token(client, internal_token):
    response = client.post(
        "/internal/search",
        json={"organizationId": "org-a", "query": "x"},
        headers={"X-Internal-Service-Token": "wrong-token"},
    )
    body = response.text
    assert internal_token not in body
    assert "wrong-token" not in body


def test_missing_and_wrong_token_are_indistinguishable(client):
    """Responses must not reveal whether a token was supplied at all."""
    missing = client.post("/internal/search", json={"organizationId": "o", "query": "x"})
    wrong = client.post(
        "/internal/search",
        json={"organizationId": "o", "query": "x"},
        headers={"X-Internal-Service-Token": "nope"},
    )
    assert missing.status_code == wrong.status_code == 401
    assert missing.json() == wrong.json()


def test_health_routes_do_not_require_a_token(client):
    assert client.get("/health/live").status_code == 200


def test_valid_token_passes_the_guard(client, auth_headers):
    """A valid token gets past auth (the request may then fail for other reasons)."""
    response = client.post(
        "/internal/rerank",
        json={"query": "kubernetes", "hits": []},
        headers=auth_headers,
    )
    assert response.status_code != 401
