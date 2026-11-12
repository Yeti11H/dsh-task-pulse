package io.github.yeti11h.pulse;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api")
final class Api {
    private final Workbench work;
    Api(Workbench work) { this.work = work; }
    record Open(String sessionId, String repo, String branch) {}
    record Stage(String path, String expectedSha, String content) {}
    record Publish(String title) {}
    @GetMapping("/account") Object account() { return Map.of("login", work.account(), "loginCommand", "gh auth login --web --hostname github.com"); }
    @GetMapping("/repos") Object repos(@RequestParam(defaultValue = "1") int page) { return work.repos(page); }
    @GetMapping("/branches") Object branches(@RequestParam String repo, @RequestParam(defaultValue = "1") int page) { return work.branches(repo, page); }
    @PostMapping("/contexts") Object open(@RequestBody Open input) { return work.open(input.sessionId(), input.repo(), input.branch()); }
    @PostMapping("/contexts/{id}/close") Object close(@PathVariable String id) { work.close(id); return Map.of("closed", true); }
    @GetMapping("/contexts/{id}") Object context(@PathVariable String id) { return work.context(id); }
    @GetMapping("/contexts/{id}/file") Object file(@PathVariable String id, @RequestParam String path) { return work.file(id, path); }
    @GetMapping("/contexts/{id}/changes") Object changes(@PathVariable String id) { return work.changes(id); }
    @GetMapping("/contexts/{id}/checks") Object checks(@PathVariable String id) { return work.checks(id); }
    @PostMapping("/contexts/{id}/stage") Object stage(@PathVariable String id, @RequestBody Stage input) { return work.stage(id, input.path(), input.expectedSha(), input.content()); }
    @PostMapping("/contexts/{id}/publish") Object publish(@PathVariable String id, @RequestBody Publish input) { return work.publish(id, input.title()); }
    /** Agent endpoint has a deliberately smaller capability than the browser API. */
    @PostMapping("/agent/{session}/action") Object agent(@PathVariable String session, @RequestBody AgentAction input) {
        var context = work.forSession(session);
        if (!input.action().equals("context") && !context.id().equals(input.contextId())) throw new Problem("agent-context-changed", 409);
        return switch (input.action()) {
            case "context" -> context;
            case "read" -> work.file(context.id(), input.path());
            case "propose" -> {
                var draft = work.stage(context.id(), input.path(), input.expectedSha(), input.content());
                // The model already supplied the code. Return a small receipt;
                // full before/after content belongs in the browser review API.
                yield Map.of("contextId", draft.contextId(), "status", draft.status(), "changes", draft.changes().stream()
                    .map(change -> Map.of("path", change.path(), "originalSha", change.originalSha())).toList());
            }
            default -> throw new Problem("unsupported-agent-action", 400);
        };
    }
    record AgentAction(String action, String contextId, String path, String expectedSha, String content) {}
    @ExceptionHandler(Problem.class) ResponseEntity<?> problem(Problem problem) { return ResponseEntity.status(problem.status).body(Map.of("error", problem.code)); }
    @ExceptionHandler(Exception.class) ResponseEntity<?> unexpected(Exception problem) { return ResponseEntity.status(400).body(Map.of("error", "invalid-request")); }
}
