package io.github.yeti11h.pulse;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import java.security.SecureRandom;
import java.util.Base64;

@SpringBootApplication
public class Application {
    public static void main(String[] args) { SpringApplication.run(Application.class, args); }
    @Bean String pairingToken() {
        String configured = System.getenv("PULSE_BRIDGE_TOKEN");
        if (configured != null && configured.matches("[A-Za-z0-9_-]{32,160}")) return configured;
        byte[] random = new byte[32]; new SecureRandom().nextBytes(random);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(random);
    }
    @Bean GithubTransport githubTransport(@Value("${pulse.gh:gh}") String executable, ObjectMapper json) { return new GhTransport(executable, json); }
    @Bean Workbench workbench(GithubTransport transport, ObjectMapper json) { return new Workbench(transport, json); }
    @Bean ApplicationRunner instructions(String pairingToken) {
        return args -> {
            System.out.println("Pulse GitHub companion bound to loopback. Pairing token (keep local):");
            System.out.println(pairingToken);
            System.out.println("Login with: gh auth login --web --hostname github.com");
            System.out.println("For Agent tools, start DSH with the same PULSE_BRIDGE_TOKEN.");
        };
    }
}
