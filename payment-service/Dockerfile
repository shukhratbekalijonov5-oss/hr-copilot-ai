# ---- Build stage ------------------------------------------------------------
FROM gradle:8.14.3-jdk21 AS build
WORKDIR /workspace
COPY build.gradle settings.gradle gradle.properties ./
# Warm the dependency cache first so source edits do not re-download the world.
RUN gradle dependencies --no-daemon -q || true
COPY src ./src
RUN gradle bootJar --no-daemon

# ---- Runtime stage ----------------------------------------------------------
FROM eclipse-temurin:21-jre
RUN useradd --system --uid 10001 payment
WORKDIR /app
COPY --from=build /workspace/build/libs/payment-service-*.jar app.jar
USER payment
EXPOSE 8081
# All secrets and datasource settings arrive from the environment.
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
