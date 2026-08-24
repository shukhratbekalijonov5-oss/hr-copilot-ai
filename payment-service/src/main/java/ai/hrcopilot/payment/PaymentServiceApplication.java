package ai.hrcopilot.payment;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * HR Copilot AI — Payment Service.
 *
 * The billing authority for candidate plans (FREE / PRO / MAX). Owns
 * subscriptions, payments, provider webhook intake and the transactional
 * outbox; publishes billing facts to Kafka; answers the internal
 * entitlement contract the NestJS backend enforces with.
 *
 * This service's PostgreSQL database is the source of truth for billing
 * state. Kafka is asynchronous integration only — nothing here (or in any
 * consumer) treats a topic as the place subscription truth lives.
 */
@SpringBootApplication
@EnableScheduling
@ConfigurationPropertiesScan
public class PaymentServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(PaymentServiceApplication.class, args);
    }
}
