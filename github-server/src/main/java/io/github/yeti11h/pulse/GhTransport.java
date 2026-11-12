package io.github.yeti11h.pulse;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** Reuses official CLI credential handling. Never calls auth token or reads its store. */
final class GhTransport implements GithubTransport {
    private final String executable;
    private final ObjectMapper json;
    GhTransport(String executable, ObjectMapper json) { this.executable = executable; this.json = json; }
    @Override public JsonNode api(String method, String path, JsonNode body) {
        if (!List.of("GET", "POST").contains(method) || !path.matches("(?:user|repos)/?[A-Za-z0-9_./%?=&:+-]*") || path.contains(".."))
            throw new Problem("invalid-endpoint", 400);
        var command = new ArrayList<>(List.of(executable, "api", "--hostname", "github.com", "--method", method,
            "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2022-11-28", path));
        if (body != null) command.addAll(List.of("--input", "-"));
        Process process = null;
        try {
            var builder = new ProcessBuilder(command);
            builder.environment().put("GH_PROMPT_DISABLED", "1");
            builder.environment().put("GH_PAGER", "cat");
            builder.environment().put("GH_HOST", "github.com");
            builder.environment().put("GH_DEBUG", "");
            process = builder.start();
            var output = new ByteArrayOutputStream();
            var errors = new ByteArrayOutputStream();
            var overflow = new AtomicBoolean();
            Thread out = reader(process, process.getInputStream(), output, 3 * 1024 * 1024, overflow);
            Thread err = reader(process, process.getErrorStream(), errors, 16 * 1024, overflow);
            try (var input = process.getOutputStream()) { if (body != null) input.write(json.writeValueAsBytes(body)); }
            if (!process.waitFor(25, TimeUnit.SECONDS)) {
                kill(process); throw new Problem(method.equals("POST") ? "mutation-uncertain" : "github-timeout", 504);
            }
            out.join(1000); err.join(1000);
            if (overflow.get() || out.isAlive() || err.isAlive()) { kill(process); throw new Problem("response-too-large", 413); }
            if (process.exitValue() != 0) {
                String diagnostic = errors.toString(StandardCharsets.UTF_8);
                if (diagnostic.contains("HTTP 401") || diagnostic.contains("gh auth login")) throw new Problem("github-login-required", 401);
                if (diagnostic.contains("HTTP 404")) throw new Problem("github-not-found", 404);
                if (diagnostic.contains("HTTP 403") || diagnostic.contains("HTTP 429")) throw new Problem("github-permission-or-rate-limit", 403);
                if (diagnostic.contains("HTTP 422")) throw new Problem("github-rejected-change", 409);
                throw new Problem(method.equals("POST") ? "mutation-uncertain" : "github-unavailable", 502);
            }
            return json.readTree(output.toByteArray());
        } catch (Problem e) { throw e; }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new Problem("request-interrupted", 503); }
        catch (IOException e) { throw new Problem("github-cli-unavailable", 503); }
        finally { if (process != null && process.isAlive()) kill(process); }
    }
    private static Thread reader(Process process, java.io.InputStream input, ByteArrayOutputStream output, int limit, AtomicBoolean overflow) {
        Thread thread = new Thread(() -> {
            try (input) {
                byte[] buffer = new byte[8192]; int count;
                while ((count = input.read(buffer)) >= 0) {
                    if (output.size() + count > limit) { overflow.set(true); kill(process); return; }
                    output.write(buffer, 0, count);
                }
            } catch (IOException ignored) { /* Process status is checked by the owner. */ }
        }, "pulse-gh-output");
        thread.setDaemon(true); thread.start(); return thread;
    }
    private static void kill(Process process) {
        process.descendants().forEach(ProcessHandle::destroyForcibly); process.destroyForcibly();
    }
}
