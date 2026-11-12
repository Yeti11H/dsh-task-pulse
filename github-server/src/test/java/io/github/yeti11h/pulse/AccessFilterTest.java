package io.github.yeti11h.pulse;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import static org.junit.jupiter.api.Assertions.*;

class AccessFilterTest {
    @Test void requiresPairingAndExactOrigin() throws Exception {
        var filter = new AccessFilter("local-token", "http://localhost:3000");
        var request = new MockHttpServletRequest("GET", "/api/account"); request.setRemoteAddr("127.0.0.1");
        var missing = new MockHttpServletResponse(); filter.doFilter(request, missing, (a,b) -> fail()); assertEquals(401, missing.getStatus());
        request.addHeader("Authorization", "Bearer local-token"); request.addHeader("Origin", "https://evil.invalid");
        var wrongOrigin = new MockHttpServletResponse(); filter.doFilter(request, wrongOrigin, (a,b) -> fail()); assertEquals(403, wrongOrigin.getStatus());
        request.removeHeader("Origin"); request.addHeader("Origin", "http://localhost:3000");
        var correct = new MockHttpServletResponse(); filter.doFilter(request, correct, (a,b) -> ((MockHttpServletResponse)b).setStatus(202));
        assertEquals(202, correct.getStatus()); assertEquals("http://localhost:3000", correct.getHeader("Access-Control-Allow-Origin"));
    }
    @Test void rejectsRemotePeersAndNonJsonWrites() throws Exception {
        var filter = new AccessFilter("token", "http://localhost:3000");
        var request = new MockHttpServletRequest("POST", "/api/contexts"); request.setRemoteAddr("10.0.0.1"); request.addHeader("Authorization", "Bearer token");
        var remote = new MockHttpServletResponse(); filter.doFilter(request, remote, (a,b) -> fail()); assertEquals(403, remote.getStatus());
        request.setRemoteAddr("127.0.0.1"); request.setContentType("text/plain");
        var text = new MockHttpServletResponse(); filter.doFilter(request, text, (a,b) -> fail()); assertEquals(415, text.getStatus());
    }
    @Test void rejectsOversizeChunkedJsonWithoutCallingController() throws Exception {
        var filter = new AccessFilter("token", "http://localhost:3000");
        var request = new MockHttpServletRequest("POST", "/api/contexts") {
            @Override public long getContentLengthLong() { return -1; }
        };
        request.setRemoteAddr("127.0.0.1"); request.addHeader("Authorization", "Bearer token");
        request.setContentType("application/json"); request.setContent(new byte[1024 * 1024 + 1]);
        var response = new MockHttpServletResponse();
        filter.doFilter(request, response, (a,b) -> fail()); assertEquals(413, response.getStatus());
    }
}
