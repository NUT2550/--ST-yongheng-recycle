/**
 * TEST_FIXTURE_ONLY. This script never connects to a database and never creates
 * a Production allowlist. Runtime database access for future release tooling
 * must use process.env.DATABASE_URL and fail closed when it is absent.
 */
if (process.env.DATABASE_URL) {
  throw new Error('Refusing to run fixture generator while DATABASE_URL is set')
}
console.log('ST-48 fixture artifacts are generated only inside the test suite')

