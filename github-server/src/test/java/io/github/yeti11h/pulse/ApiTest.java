package io.github.yeti11h.pulse;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ApiTest {
    @LocalServerPort int port;
    @Autowired String pairingToken;
    @Autowired ObjectMapper json;
    @Autowired GithubTransport transport;
    @TestConfiguration static class Config {
        @Bean @Primary GithubTransport fake() { return new WorkbenchTest.Fake(); }
    }
    @Test void realHttpRoundTripRequiresPairingAndOnlyStagesAgentChanges() throws Exception {
        var client = HttpClient.newHttpClient();
        var account = URI.create("http://127.0.0.1:" + port + "/api/account");
        assertEquals(401, client.send(HttpRequest.newBuilder(account).GET().build(), HttpResponse.BodyHandlers.ofString()).statusCode());
        var accepted = client.send(HttpRequest.newBuilder(account).header("Authorization", "Bearer " + pairingToken).GET().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(200, accepted.statusCode()); assertEquals("alice", json.readTree(accepted.body()).path("login").asText());
        var context = client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/contexts"))
            .header("Authorization", "Bearer " + pairingToken).header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString("{\"sessionId\":\"api-test\",\"repo\":\"alice/demo\",\"branch\":\"main\"}")).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(200, context.statusCode());
        var agent = client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/agent/api-test/action"))
            .header("Authorization", "Bearer " + pairingToken).header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString("{\"action\":\"publish\"}")).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(409, agent.statusCode()); assertTrue(agent.body().contains("agent-context-changed"));
        String contextId = json.readTree(context.body()).path("id").asText();
        var endpoint = URI.create("http://127.0.0.1:" + port + "/api/agent/api-test/action");
        var publish = client.send(HttpRequest.newBuilder(endpoint).header("Authorization", "Bearer " + pairingToken)
            .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(
                json.createObjectNode().put("action", "publish").put("contextId", contextId).toString())).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(400, publish.statusCode()); assertTrue(publish.body().contains("unsupported-agent-action"));
        var proposed = client.send(HttpRequest.newBuilder(endpoint).header("Authorization", "Bearer " + pairingToken)
            .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(
                json.createObjectNode().put("action", "propose").put("contextId", contextId).put("path", "src/App.java")
                    .put("expectedSha", WorkbenchTest.BLOB).put("content", "class App { int n; }\n").toString())).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(200, proposed.statusCode()); assertEquals(1, json.readTree(proposed.body()).path("changes").size());
        assertEquals(0, ((WorkbenchTest.Fake) transport).writes);
    }
}
