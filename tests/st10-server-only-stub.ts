// ST-10: Stub 'server-only' + set test env vars for the test environment.
import { plugin } from 'bun';

// Set JWT_SECRET for tests (auth.ts requires it at module load)
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-jwt-secret-for-st10-tests-not-production';
}

plugin({
  name: 'server-only-stub',
  setup(build) {
    build.onResolve({ filter: /^server-only$/ }, (args) => ({
      path: args.path,
      namespace: 'server-only-stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'server-only-stub' }, () => ({
      contents: 'export {}',
      loader: 'js',
    }));
  },
});
