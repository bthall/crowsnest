## 2026-10-23 - Constant-Time Hashing for Enrollment Code Verification
**Vulnerability:** In `Authentication.enroll()`, invalid setup/recovery codes returned a 403 response immediately before performing `scrypt` password hashing, allowing attackers to distinguish valid setup or recovery codes via response timing side-channels.
**Learning:** Checking fast conditions (like code hashes) before computationally expensive password derivations (scrypt) leaks state via response latency unless dummy password verification is executed on failure.
**Prevention:** In functions accepting passwords along with codes or usernames, perform `await this.#verify(password, this.dummy)` on the negative branch to maintain timing uniformity.
