package io.github.yeti11h.pulse;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.IOException;
import java.io.ByteArrayInputStream;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

@Component
final class AccessFilter extends OncePerRequestFilter {
    private final String token;
    private final Set<String> origins;
    AccessFilter(String pairingToken, @Value("${pulse.allowed-origin}") String allowed) {
        token = "Bearer " + pairingToken;
        origins = Arrays.stream(allowed.split(",")).map(String::strip).collect(Collectors.toSet());
        if (origins.contains("*") || origins.contains("null")) throw new IllegalArgumentException("explicit-browser-origin-required");
    }
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws IOException, ServletException {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        String origin = request.getHeader("Origin");
        if (origin != null && !origins.contains(origin)) { response.sendError(403); return; }
        if (!Set.of("127.0.0.1", "::1", "0:0:0:0:0:0:0:1").contains(request.getRemoteAddr())) { response.sendError(403); return; }
        if (origin != null) {
            response.setHeader("Access-Control-Allow-Origin", origin);
            response.setHeader("Vary", "Origin");
            response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
            response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        }
        if (request.getMethod().equals("OPTIONS")) { response.setStatus(204); return; }
        String supplied = request.getHeader("Authorization");
        if (supplied == null || !MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8), supplied.getBytes(StandardCharsets.UTF_8))) { response.sendError(401); return; }
        if (request.getContentLengthLong() > 1024 * 1024) { response.sendError(413); return; }
        if (request.getMethod().equals("POST") && (request.getContentType() == null || !request.getContentType().startsWith("application/json"))) { response.sendError(415); return; }
        if (request.getMethod().equals("POST")) {
            byte[] bytes = request.getInputStream().readNBytes(1024 * 1024 + 1);
            if (bytes.length > 1024 * 1024) { response.sendError(413); return; }
            chain.doFilter(new HttpServletRequestWrapper(request) {
                @Override public ServletInputStream getInputStream() {
                    var input = new ByteArrayInputStream(bytes);
                    return new ServletInputStream() {
                        @Override public int read() { return input.read(); }
                        @Override public boolean isFinished() { return input.available() == 0; }
                        @Override public boolean isReady() { return true; }
                        @Override public void setReadListener(ReadListener listener) { throw new UnsupportedOperationException(); }
                    };
                }
                @Override public BufferedReader getReader() { return new BufferedReader(new InputStreamReader(getInputStream(), StandardCharsets.UTF_8)); }
            }, response);
        } else chain.doFilter(request, response);
    }
}
