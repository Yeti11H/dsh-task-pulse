package io.github.yeti11h.pulse;

import com.fasterxml.jackson.databind.JsonNode;

interface GithubTransport {
    JsonNode api(String method, String path, JsonNode body);
}
