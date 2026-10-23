## 2026-10-23 - Rejection of Dummy Hashing on High-Entropy One-Time Codes
**Vulnerability:** Hypothetical timing difference between invalid code checks and password hashing in `Authentication.enroll()`.
**Learning:** Setup/recovery codes are 256-bit high-entropy secrets whose SHA-256 hashes are verified in constant time (`timingSafeEqual`). A timing difference only reveals whether a 256-bit random token matched. Adding expensive `scrypt` hashing on invalid token requests creates a CPU DoS vector without providing practical security benefit.
**Prevention:** Do not add expensive key derivation functions (`scrypt`) to invalid request paths when verifying high-entropy, constant-time compared, single-use tokens.
