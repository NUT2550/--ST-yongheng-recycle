// Set JWT_SECRET for tests
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-jwt-secret-for-st10-tests-not-production';
}
