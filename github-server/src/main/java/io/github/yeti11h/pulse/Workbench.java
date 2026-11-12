package io.github.yeti11h.pulse;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URLEncoder;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Bounded single-user workspace. Reading/proposing never mutates GitHub. */
final class Workbench {
    record Repo(String name, String defaultBranch, boolean writable) {}
    record Page<T>(List<T> items, int page, boolean more) {}
    record Entry(String path, String type, String sha, int size, String mode) {}
    record Context(String id, String sessionId, String repo, String branch, String baseSha, boolean writable, List<Entry> entries, boolean truncated) {}
    record File(String path, String sha, String commit, String content) {}
    record Change(String path, String originalSha, String original, String content) {}
    record Draft(String contextId, List<Change> changes, String status, String publishedUrl, String branch) {}
    record Annotation(String path, int line, int endLine, String level, String message, String sha, String check) {}
    record Checks(List<Annotation> annotations, boolean truncated, String sha, int checkCount) {}
    record Published(String url, String branch, String sha) {}
    private static final int MAX_BYTES = 192 * 1024;
    private final GithubTransport github;
    private final ObjectMapper json;
    private final LinkedHashMap<String, State> contexts = new LinkedHashMap<>();
    private static class State {
        final Context context;
        final LinkedHashMap<String, Change> changes = new LinkedHashMap<>();
        final long created = System.currentTimeMillis();
        String commit, branch, url;
        String title;
        boolean branchAttempted;
        State(Context context) { this.context = context; }
    }
    Workbench(GithubTransport github, ObjectMapper json) { this.github = github; this.json = json; }
    String account() { return github.api("GET", "user", null).path("login").asText(); }
    Page<Repo> repos(int page) {
        page(page);
        var rows = github.api("GET", "user/repos?per_page=50&sort=updated&page=" + page, null);
        var items = new ArrayList<Repo>();
        for (var row : rows) items.add(new Repo(row.path("full_name").asText(), row.path("default_branch").asText(), row.path("permissions").path("push").asBoolean()));
        return new Page<>(List.copyOf(items), page, rows.size() == 50 && page < 20);
    }
    Page<String> branches(String repo, int page) {
        repository(repo); page(page);
        var rows = github.api("GET", "repos/" + repo + "/branches?per_page=50&page=" + page, null);
        var items = new ArrayList<String>(); for (var row : rows) items.add(row.path("name").asText());
        return new Page<>(List.copyOf(items), page, rows.size() == 50 && page < 20);
    }
    synchronized Context open(String session, String repo, String branch) {
        repository(repo); ref(branch);
        if (session == null || !session.matches("[A-Za-z0-9_.:-]{1,150}")) throw new Problem("invalid-session", 400);
        var metadata = github.api("GET", "repos/" + repo, null);
        String head = head(repo, branch);
        var tree = github.api("GET", "repos/" + repo + "/git/trees/" + head + "?recursive=1", null);
        var entries = new ArrayList<Entry>();
        for (var row : tree.path("tree")) {
            String path = row.path("path").asText();
            try { path(path); } catch (Problem excluded) { continue; }
            String mode = row.path("mode").asText();
            if (!mode.equals("100644") && !mode.equals("100755") && !row.path("type").asText().equals("tree")) continue;
            if (entries.size() >= 1500) break;
            entries.add(new Entry(path, row.path("type").asText(), row.path("sha").asText(), row.path("size").asInt(), mode));
        }
        contexts.values().removeIf(item -> item.context.sessionId().equals(session) || System.currentTimeMillis() - item.created > 3_600_000);
        if (contexts.size() >= 8) throw new Problem("too-many-contexts", 409);
        var context = new Context(UUID.randomUUID().toString(), session, repo, branch, head,
            metadata.path("permissions").path("push").asBoolean(), List.copyOf(entries), tree.path("truncated").asBoolean() || tree.path("tree").size() > 1500);
        contexts.put(context.id(), new State(context)); return context;
    }
    synchronized Context forSession(String session) {
        var context = contexts.values().stream().map(item -> item.context).filter(item -> item.sessionId().equals(session)).findFirst()
            .orElseThrow(() -> new Problem("select-repository-first", 409));
        return state(context.id()).context;
    }
    synchronized Context context(String id) { return state(id).context; }
    synchronized void close(String id) { contexts.remove(id); }
    synchronized File file(String id, String path) {
        path(path); var context = state(id).context;
        Entry entry = context.entries().stream().filter(item -> item.path().equals(path) && item.type().equals("blob")).findFirst()
            .orElseThrow(() -> new Problem("file-not-in-snapshot", 404));
        if (entry.size() > MAX_BYTES) throw new Problem("file-too-large", 413);
        var blob = github.api("GET", "repos/" + context.repo() + "/git/blobs/" + entry.sha(), null);
        if (!blob.path("encoding").asText().equals("base64")) throw new Problem("unsupported-file", 415);
        try {
            byte[] bytes = Base64.getMimeDecoder().decode(blob.path("content").asText());
            if (bytes.length > MAX_BYTES) throw new Problem("file-too-large", 413);
            for (byte b : bytes) if (b == 0) throw new Problem("binary-file", 415);
            String content = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
            return new File(path, entry.sha(), context.baseSha(), content);
        } catch (Problem e) { throw e; } catch (Exception e) { throw new Problem("unsupported-file", 415); }
    }
    synchronized Draft stage(String id, String path, String expected, String content) {
        var state = state(id);
        if (state.commit != null || state.branchAttempted) throw new Problem("draft-locked", 409);
        if (content == null || content.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES || content.indexOf('\0') >= 0) throw new Problem("file-too-large", 413);
        var original = file(id, path);
        if (!original.sha().equals(expected)) throw new Problem("file-version-mismatch", 409);
        if (!state.changes.containsKey(path) && state.changes.size() >= 10) throw new Problem("too-many-files", 413);
        if (content.equals(original.content())) state.changes.remove(path);
        else state.changes.put(path, new Change(path, original.sha(), original.content(), content));
        return changes(id);
    }
    synchronized Draft changes(String id) {
        var state = state(id);
        return new Draft(id, List.copyOf(state.changes.values()), state.url != null ? "published" : state.branch != null ? "branch-created" : state.commit != null ? "publishing" : "draft", state.url, state.branch);
    }
    synchronized Checks checks(String id) {
        var context = state(id).context;
        var runs = github.api("GET", "repos/" + context.repo() + "/commits/" + context.baseSha() + "/check-runs?per_page=30", null);
        var annotations = new ArrayList<Annotation>();
        boolean truncated = runs.path("total_count").asInt() > 30;
        int visited = 0;
        for (var run : runs.path("check_runs")) {
            if (!run.path("head_sha").asText().equals(context.baseSha())) continue;
            int count = run.path("output").path("annotations_count").asInt();
            if (count == 0) continue;
            if (++visited > 6) { truncated = true; break; }
            var rows = github.api("GET", "repos/" + context.repo() + "/check-runs/" + run.path("id").asLong() + "/annotations?per_page=50", null);
            truncated |= count > 50;
            for (var row : rows) {
                String path = row.path("path").asText();
                try { path(path); } catch (Problem invalid) { continue; }
                // GitHub also reports workflow/runner notices against directories.
                // Only an actual blob in this snapshot can support a source jump.
                if (context.entries().stream().noneMatch(entry -> entry.type().equals("blob") && entry.path().equals(path))) continue;
                if (row.path("start_line").asInt() < 1) continue;
                annotations.add(new Annotation(path, row.path("start_line").asInt(), row.path("end_line").asInt(),
                    row.path("annotation_level").asText(), row.path("message").asText().substring(0, Math.min(600, row.path("message").asText().length())),
                    context.baseSha(), run.path("name").asText()));
            }
        }
        return new Checks(List.copyOf(annotations), truncated, context.baseSha(), runs.path("check_runs").size());
    }
    synchronized Published publish(String id, String title) {
        var state = state(id); var context = state.context;
        if (state.url != null) return new Published(state.url, state.branch, state.commit);
        if (!context.writable()) throw new Problem("repository-read-only", 403);
        if (title == null || title.isBlank() || title.length() > 160) throw new Problem("invalid-title", 400);
        if (state.changes.isEmpty()) throw new Problem("no-changes", 409);
        if (state.title != null && !state.title.equals(title)) throw new Problem("publish-title-locked", 409);
        if (state.commit == null) {
            if (!head(context.repo(), context.branch()).equals(context.baseSha())) throw new Problem("base-moved", 409);
            var base = github.api("GET", "repos/" + context.repo() + "/git/commits/" + context.baseSha(), null);
            var body = json.createObjectNode().put("base_tree", base.path("tree").path("sha").asText());
            var entries = body.putArray("tree");
            for (var change : state.changes.values()) entries.addObject().put("path", change.path()).put("mode", mode(context, change.path())).put("type", "blob").put("content", change.content());
            String tree = github.api("POST", "repos/" + context.repo() + "/git/trees", body).path("sha").asText();
            var commit = json.createObjectNode().put("message", title).put("tree", tree); commit.putArray("parents").add(context.baseSha());
            state.commit = github.api("POST", "repos/" + context.repo() + "/git/commits", commit).path("sha").asText();
            sha(state.commit); state.title = title;
        }
        String branch = "pulse/" + context.id();
        if (state.branch == null) {
            if (!head(context.repo(), context.branch()).equals(context.baseSha())) throw new Problem("base-moved", 409);
            if (state.branchAttempted) {
                try {
                    var ref = github.api("GET", "repos/" + context.repo() + "/git/ref/heads/" + segment(branch), null);
                    if (!ref.path("object").path("sha").asText().equals(state.commit)) throw new Problem("publish-reconciliation-required", 409);
                    state.branch = branch;
                } catch (Problem missing) {
                    if (!missing.code.equals("github-not-found")) throw missing;
                    state.branchAttempted = false;
                }
            }
            if (!state.branchAttempted) {
                // Mark before sending: if transport outcome is unknown, reconcile the ref.
                state.branchAttempted = true;
                github.api("POST", "repos/" + context.repo() + "/git/refs", json.createObjectNode().put("ref", "refs/heads/" + branch).put("sha", state.commit));
            }
            state.branch = branch;
        }
        var existing = github.api("GET", "repos/" + context.repo() + "/pulls?state=all&head=" + segment(context.repo().split("/")[0] + ":" + branch) + "&base=" + segment(context.branch()), null);
        if (existing.isArray() && !existing.isEmpty()) state.url = existing.get(0).path("html_url").asText();
        else {
            var pr = json.createObjectNode().put("title", state.title).put("head", branch).put("base", context.branch()).put("draft", true)
                .put("body", "Proposed from DSH Pulse. Review the diff before merging.\n\nBase commit: `" + context.baseSha() + "`\n\nNo tests were executed by this workbench.");
            state.url = github.api("POST", "repos/" + context.repo() + "/pulls", pr).path("html_url").asText();
        }
        if (!state.url.startsWith("https://github.com/" + context.repo() + "/pull/")) throw new Problem("invalid-publish-result", 502);
        return new Published(state.url, state.branch, state.commit);
    }
    private String mode(Context context, String path) {
        // Preserve executable files instead of changing their mode on publication.
        for (var entry : context.entries()) if (entry.path().equals(path)) return entry.mode();
        throw new Problem("file-not-in-snapshot", 409);
    }
    private State state(String id) {
        var state = contexts.get(id);
        if (state == null) throw new Problem("context-expired", 404);
        if (System.currentTimeMillis() - state.created > 3_600_000) { contexts.remove(id); throw new Problem("context-expired", 404); }
        return state;
    }
    private String head(String repo, String branch) {
        String sha = github.api("GET", "repos/" + repo + "/branches/" + segment(branch), null).path("commit").path("sha").asText();
        sha(sha); return sha;
    }
    static String segment(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20"); }
    static void repository(String value) { if (value == null || !value.matches("[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}") || value.contains("..")) throw new Problem("invalid-repository", 400); }
    static void ref(String value) { if (value == null || value.isBlank() || value.length() > 200 || value.startsWith("-") || value.contains("..") || !value.matches("[A-Za-z0-9_./-]+")) throw new Problem("invalid-branch", 400); }
    static void sha(String value) { if (value == null || !value.matches("[0-9a-f]{40}")) throw new Problem("invalid-commit", 400); }
    static void path(String value) {
        if (value == null || value.length() > 700 || value.startsWith("/") || value.contains("\\") || value.contains(":")) throw new Problem("invalid-path", 400);
        for (String part : value.split("/", -1)) if (part.isEmpty() || part.equals(".") || part.equals("..") || part.equalsIgnoreCase(".git") ||
            part.toLowerCase(Locale.ROOT).startsWith(".env") || part.equals(".npmrc") || part.endsWith(".pem") || part.endsWith(".key")) throw new Problem("restricted-path", 400);
    }
    private static void page(int page) { if (page < 1 || page > 20) throw new Problem("invalid-page", 400); }
}
