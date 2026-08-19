"""Real PyTorch embedding behaviour (no mocks — this is the actual model)."""

from __future__ import annotations

import math

import pytest

pytestmark = pytest.mark.slow


class TestEmbeddingModel:
    def test_reports_its_dimension_from_the_loaded_model(self, embedder):
        """Dimension is read from the model, never hardcoded."""
        assert embedder.dimension == 384
        assert embedder.is_loaded

    def test_query_vector_has_the_model_dimension(self, embedder):
        vector = embedder.encode_query("production Kubernetes experience")
        assert len(vector) == embedder.dimension

    def test_vectors_are_unit_normalised_for_cosine(self, embedder):
        vector = embedder.encode_query("Redis Pub/Sub")
        norm = math.sqrt(sum(x * x for x in vector))
        assert norm == pytest.approx(1.0, abs=1e-3)

    def test_batch_encoding_returns_one_vector_per_passage(self, embedder):
        passages = ["NestJS services", "Kubernetes operations", "Spark pipelines"]
        vectors = embedder.encode_passages(passages)

        assert len(vectors) == 3
        assert all(len(v) == embedder.dimension for v in vectors)

    def test_empty_input_returns_empty_output(self, embedder):
        assert embedder.encode_passages([]) == []

    def test_encoding_is_deterministic(self, embedder):
        a = embedder.encode_query("Kubernetes")
        b = embedder.encode_query("Kubernetes")
        assert a == pytest.approx(b, abs=1e-6)


class TestSemanticQuality:
    """The embedding space must actually separate related from unrelated text."""

    @staticmethod
    def _cos(a, b):
        return sum(x * y for x, y in zip(a, b))

    def test_related_text_scores_above_unrelated(self, embedder):
        query = embedder.encode_query("production Kubernetes experience")
        related, unrelated = embedder.encode_passages(
            [
                "Led the migration of the platform to a production Kubernetes cluster",
                "Modelled the warehouse in dbt and BigQuery for financial reporting",
            ]
        )

        assert self._cos(query, related) > self._cos(query, unrelated)

    def test_multilingual_query_matches_english_passage(self, embedder):
        """A Korean query must retrieve English evidence — the reason for this model."""
        korean_query = embedder.encode_query("쿠버네티스 운영 경험")
        related, unrelated = embedder.encode_passages(
            [
                "Operated a production Kubernetes cluster with rolling deploys",
                "Wrote nightly reconciliation pipelines in Python and Apache Spark",
            ]
        )

        assert self._cos(korean_query, related) > self._cos(korean_query, unrelated)
