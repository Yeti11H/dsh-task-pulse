package io.github.yeti11h.pulse;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class WorkbenchTest {
    static final String SHA = "a".repeat(40), NEW = "b".repeat(40), BLOB = "c".repeat(40);
    static final ObjectMapper JSON = new ObjectMapper();
    static class Fake implements GithubTransport {
        String head = SHA;
        int writes, refs, prs;
        boolean failPr, uncertainRef, refExists, staleCheck, readOnly;
        final List<String> paths = new ArrayList<>();
        public JsonNode api(String method, String path, JsonNode body) {
            paths.add(method + " " + path);
            if (method.equals("POST")) {
                writes++;
                if (path.endsWith("/git/trees")) return node("{\"sha\":\"" + NEW + "\"}");
                if (path.endsWith("/git/commits")) return node("{\"sha\":\"" + NEW + "\"}");
                if (path.endsWith("/git/refs")) {
                    assertTrue(body.path("ref").asText().startsWith("refs/heads/pulse/"));
                    refs++; refExists = true;
                    if (uncertainRef) { uncertainRef = false; throw new Problem("mutation-uncertain", 504); }
                    return node("{\"object\":{\"sha\":\"" + NEW + "\"}}");
                }
                if (path.endsWith("/pulls")) {
                    if (failPr) { failPr = false; throw new Problem("github-unavailable", 502); }
                    prs++; return node("{\"html_url\":\"https://github.com/alice/demo/pull/1\",\"number\":1}");
                }
                fail("unexpected mutation: " + path);
            }
            if (path.equals("user")) return node("{\"login\":\"alice\"}");
            if (path.startsWith("repos/alice/demo/branches/")) return node("{\"commit\":{\"sha\":\"" + head + "\"}}");
            if (path.equals("repos/alice/demo")) return node("{\"full_name\":\"alice/demo\",\"default_branch\":\"main\",\"permissions\":{\"push\":" + !readOnly + "}}");
            if (path.contains("/git/ref/heads/")) {
                if (!refExists) throw new Problem("github-not-found", 404);
                return node("{\"object\":{\"sha\":\"" + NEW + "\"}}");
            }
            if (path.contains("/git/commits/")) return node("{\"tree\":{\"sha\":\"" + SHA + "\"}}");
            if (path.contains("/git/trees/")) return node("{\"truncated\":false,\"tree\":[{\"path\":\"src/App.java\",\"type\":\"blob\",\"mode\":\"100644\",\"size\":24,\"sha\":\"" + BLOB + "\"}]}");
            if (path.contains("/git/blobs/")) return node("{\"encoding\":\"base64\",\"content\":\"" + Base64.getEncoder().encodeToString("class App {}\n".getBytes(StandardCharsets.UTF_8)) + "\"}");
            if (path.contains("/check-runs?")) return node("{\"total_count\":1,\"check_runs\":[{\"id\":7,\"head_sha\":\"" + (staleCheck ? NEW : SHA) + "\",\"name\":\"test\",\"conclusion\":\"failure\",\"output\":{\"annotations_count\":1}}]}");
            if (path.contains("/annotations?")) return node("[{\"path\":\"src/App.java\",\"start_line\":1,\"annotation_level\":\"failure\",\"message\":\"expected result\"}]");
            if (path.contains("/pulls?")) return node("[]");
            fail("unexpected read: " + path); return null;
        }
    }
    static JsonNode node(String value) { try { return JSON.readTree(value); } catch (Exception e) { throw new AssertionError(e); } }
    static Workbench service(Fake fake) { return new Workbench(fake, JSON); }

    @Test void pinnedFileAndAnnotationUseExactCommitAndNoWrites() {
        var fake = new Fake(); var work = service(fake);
        var context = work.open("session-a", "alice/demo", "main");
        assertEquals(SHA, context.baseSha());
        assertEquals("class App {}\n", work.file(context.id(), "src/App.java").content());
        assertEquals(1, work.checks(context.id()).annotations().size());
        assertEquals(SHA, work.checks(context.id()).annotations().get(0).sha());
        assertEquals(0, fake.writes);
    }
    @Test void wrongBlobAndTraversalCannotStage() {
        var work = service(new Fake()); var context = work.open("a", "alice/demo", "main");
        for (String path : List.of("../file", ".git/config", "/absolute", "a\\b", ".env"))
            assertThrows(Problem.class, () -> work.stage(context.id(), path, BLOB, "updated"));
        assertThrows(Problem.class, () -> work.stage(context.id(), "src/App.java", SHA, "updated"));
        assertEquals(0, work.changes(context.id()).changes().size());
    }
    @Test void proposalChangesOnlyMemoryUntilExplicitPublishAndPublishIsIdempotent() {
        var fake = new Fake(); var work = service(fake); var context = work.open("a", "alice/demo", "main");
        work.stage(context.id(), "src/App.java", BLOB, "class App { int n = 2; }\n");
        assertEquals(0, fake.writes);
        var first = work.publish(context.id(), "Fix App");
        assertEquals(first.url(), work.publish(context.id(), "Fix App").url());
        assertEquals(1, fake.refs); assertEquals(1, fake.prs);
        assertTrue(fake.paths.stream().noneMatch(path -> path.startsWith("PATCH") || path.startsWith("PUT")));
    }
    @Test void movedBaseFailsBeforeCreatingAnyBranch() {
        var fake = new Fake(); var work = service(fake); var context = work.open("a", "alice/demo", "main");
        work.stage(context.id(), "src/App.java", BLOB, "new content\n"); fake.head = NEW;
        assertEquals("base-moved", assertThrows(Problem.class, () -> work.publish(context.id(), "Fix")).code);
        assertEquals(0, fake.writes);
    }
    @Test void failedPrCanBeRetriedWithoutCreatingAnotherCommitOrBranch() {
        var fake = new Fake(); var work = service(fake); var context = work.open("a", "alice/demo", "main");
        work.stage(context.id(), "src/App.java", BLOB, "new content\n"); fake.failPr = true;
        assertThrows(Problem.class, () -> work.publish(context.id(), "Fix"));
        assertEquals(1, fake.refs);
        assertNotNull(work.publish(context.id(), "Fix").url());
        assertEquals(1, fake.refs); assertEquals(1, fake.prs);
    }
    @Test void disconnectInvalidatesSessionToolContextAndDraftContents() {
        var work = service(new Fake()); var context = work.open("a", "alice/demo", "main");
        assertEquals(context.id(), work.forSession("a").id());
        work.close(context.id());
        assertThrows(Problem.class, () -> work.forSession("a"));
        assertThrows(Problem.class, () -> work.file(context.id(), "src/App.java"));
    }
    @Test void uncertainBranchCreationIsReconciledWithoutBlindReplay() {
        var fake = new Fake(); var work = service(fake); var context = work.open("a", "alice/demo", "main");
        work.stage(context.id(), "src/App.java", BLOB, "updated\n"); fake.uncertainRef = true;
        assertThrows(Problem.class, () -> work.publish(context.id(), "Fix"));
        assertNotNull(work.publish(context.id(), "Fix").url()); assertEquals(1, fake.refs);
    }
    @Test void staleAnnotationsAreNotExposedAsCurrentProblems() {
        var fake = new Fake(); fake.staleCheck = true; var work = service(fake); var context = work.open("a", "alice/demo", "main");
        assertTrue(work.checks(context.id()).annotations().isEmpty());
        assertTrue(fake.paths.stream().noneMatch(path -> path.contains("/annotations?")));
    }
    @Test void readOnlyRepositoryAllowsReviewButNeverPublish() {
        var fake = new Fake(); fake.readOnly = true; var work = service(fake); var context = work.open("a", "alice/demo", "main");
        work.stage(context.id(), "src/App.java", BLOB, "updated\n");
        assertEquals("repository-read-only", assertThrows(Problem.class, () -> work.publish(context.id(), "Fix")).code);
        assertEquals(0, fake.writes);
    }
    @Test void openingAnotherRepositoryContextInvalidatesOldDraftAndSessionBinding() {
        var work = service(new Fake()); var old = work.open("same", "alice/demo", "main");
        work.stage(old.id(), "src/App.java", BLOB, "first\n");
        var current = work.open("same", "alice/demo", "main");
        assertThrows(Problem.class, () -> work.changes(old.id()));
        assertEquals(current.id(), work.forSession("same").id());
        assertTrue(work.changes(current.id()).changes().isEmpty());
    }
    @Test void annotationForDirectoryOrUnknownFileIsNotOfferedAsSourceNavigation() {
        var fake = new Fake() {
            @Override public JsonNode api(String method, String path, JsonNode body) {
                if (path.contains("/annotations?")) return node("[{\"path\":\".github\",\"start_line\":1,\"message\":\"Runner migration\"}]");
                return super.api(method, path, body);
            }
        };
        var work = service(fake); var context = work.open("a", "alice/demo", "main");
        assertTrue(work.checks(context.id()).annotations().isEmpty());
        assertEquals(1, work.checks(context.id()).checkCount());
    }
    @Test void binaryMalformedUtf8AndOversizedBlobsCannotBeOpened() {
        for (byte[] bytes : List.of(new byte[]{65, 0, 66}, new byte[]{(byte)0xc3, 0x28}, new byte[192 * 1024 + 1])) {
            var fake = new Fake() {
                @Override public JsonNode api(String method, String path, JsonNode body) {
                    if (path.contains("/git/blobs/")) return JSON.createObjectNode().put("encoding", "base64")
                        .put("content", Base64.getEncoder().encodeToString(bytes));
                    return super.api(method, path, body);
                }
            };
            var work = service(fake); var context = work.open("a", "alice/demo", "main");
            assertThrows(Problem.class, () -> work.file(context.id(), "src/App.java"));
            assertEquals(0, fake.writes);
        }
    }
    @Test void publicationPreservesExecutableFileMode() {
        var fake = new Fake() {
            @Override public JsonNode api(String method, String path, JsonNode body) {
                if (method.equals("POST") && path.endsWith("/git/trees")) assertEquals("100755", body.path("tree").get(0).path("mode").asText());
                var result = super.api(method, path, body);
                if (method.equals("GET") && path.contains("/git/trees/")) ((ObjectNode)result.path("tree").get(0)).put("mode", "100755");
                return result;
            }
        };
        var work = service(fake); var context = work.open("a", "alice/demo", "main");
        work.stage(context.id(), "src/App.java", BLOB, "updated\n"); work.publish(context.id(), "Fix");
        assertEquals(1, fake.refs); assertEquals(1, fake.prs);
    }
}
