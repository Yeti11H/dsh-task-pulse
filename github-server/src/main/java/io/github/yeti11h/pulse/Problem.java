package io.github.yeti11h.pulse;

/** Stable public errors; raw CLI diagnostics never cross the service boundary. */
final class Problem extends RuntimeException {
    final String code;
    final int status;
    Problem(String code, int status) { super(code); this.code = code; this.status = status; }
}
