package ai.hrcopilot.payment.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Service-to-service authentication for every /internal/** route.
 *
 * The caller (NestJS) presents the shared credential in `X-Internal-Token`.
 * Comparison is constant-time; an UNSET credential rejects everything —
 * a deployment that forgot to configure the token exposes nothing rather
 * than everything. Webhooks live under /webhooks/** on purpose: a real PSP
 * cannot send our internal header, so that surface authenticates by
 * provider signature instead (see PaymentProvider.verifyWebhookSignature).
 * Actuator health/metrics stay open for orchestrators.
 */
@Component
public class InternalAuthFilter extends OncePerRequestFilter {

    private final PaymentServiceProperties properties;

    public InternalAuthFilter(PaymentServiceProperties properties) {
        this.properties = properties;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/internal/");
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String configured = properties.internalToken();
        String provided = request.getHeader("X-Internal-Token");
        if (configured == null
                || configured.isBlank()
                || provided == null
                || !MessageDigest.isEqual(
                        configured.getBytes(StandardCharsets.UTF_8),
                        provided.getBytes(StandardCharsets.UTF_8))) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"unauthorized\"}");
            return;
        }
        chain.doFilter(request, response);
    }
}
