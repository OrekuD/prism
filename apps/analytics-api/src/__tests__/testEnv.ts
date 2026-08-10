/**
 * Test environment bootstrap.
 *
 * MUST be imported before any module that reads `process.env.JWT_SECRET_KEY`
 * (dotenv never overrides variables that are already set).
 */
process.env.JWT_SECRET_KEY = "test-secret-key-that-is-long-enough-for-hs256";
process.env.TURSO_DATABASE_URL = "http://127.0.0.1:8082";
process.env.TURSO_AUTH_TOKEN = "test-token";
