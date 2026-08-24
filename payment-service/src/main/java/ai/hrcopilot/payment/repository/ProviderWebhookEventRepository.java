package ai.hrcopilot.payment.repository;

import ai.hrcopilot.payment.domain.entity.ProviderWebhookEvent;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProviderWebhookEventRepository extends JpaRepository<ProviderWebhookEvent, UUID> {
    Optional<ProviderWebhookEvent> findByProviderAndProviderEventId(String provider, String providerEventId);
}
