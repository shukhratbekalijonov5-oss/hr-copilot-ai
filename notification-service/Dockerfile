# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# HR Copilot AI — notification service (Spring Boot 3.5 / Java 21)
#
# Same shape as payment-service: a Gradle build stage and a JRE runtime, so
# the shipped image carries no JDK, no Gradle and no source.
#
# ## Tests are not run here
#
# This service's tests use Testcontainers, which needs a Docker daemon. A
# build stage does not have one, so running them would fail for an
# environmental reason rather than a real one. CI runs them on the host, where
# a daemon exists, BEFORE the image is built — that is the correct place for
# the gate, and it is why this stage does not silently `-x test` a suite
# nobody has run.
#
# ## Nothing is baked in
#
# SMTP credentials, the Kafka bootstrap, the datasource and the internal
# service token all arrive from the environment. `.dockerignore` keeps the
# local `.env` out of the build context.
# ---------------------------------------------------------------------------

# ---- Build ----------------------------------------------------------------
FROM gradle:8.14.3-jdk21 AS build
WORKDIR /workspace

# Manifests first, so the dependency cache survives source-only changes.
COPY build.gradle settings.gradle gradle.properties ./
RUN gradle dependencies --no-daemon -q || true

COPY src ./src
# `-x test` is safe ONLY because CI has already run the suite on a host with a
# Docker daemon. See the note above.
RUN gradle bootJar --no-daemon -x test


# ---- Runtime --------------------------------------------------------------
FROM eclipse-temurin:21-jre AS runtime

RUN useradd --system --uid 10001 notification
WORKDIR /app

COPY --from=build --chown=notification:notification \
     /workspace/build/libs/notification-service-*.jar app.jar

USER notification

# 8082 is the service port. Actuator is exposed on the SAME port and is
# reachable only inside the cluster network — health, info and prometheus are
# the three endpoints enabled in application.yml, and none of them is routed
# publicly by the ingress.
EXPOSE 8082

# Liveness from the actuator's own liveness group, so a container is only
# restarted when the JVM itself is unhealthy — not when Kafka or SMTP is
# briefly unreachable, which readiness covers separately.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD ["sh", "-c", "curl -fsS http://127.0.0.1:8082/actuator/health/liveness || exit 1"]

# `exec` form so the JVM is PID 1 and receives SIGTERM directly, which is what
# lets Spring run its shutdown hooks and finish in-flight sends.
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]
