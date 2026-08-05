/**
 * Security: fail-closed Production database URL loader for scripts/tools.
 *
 * Returns the value of the named environment variable, throwing if it is
 * missing or not a postgres:// / postgresql:// connection string.
 *
 * Never logs the URL. Never falls back. Never returns a sanitized copy.
 *
 * This helper is for Node-side scripts (reconciliation, prisma helpers, etc.).
 * The runtime Next.js app must NOT import this — it uses @/lib/db instead.
 */

export function requireDbUrl(envVarName) {
  const url = process.env[envVarName]
  if (!url) {
    throw new Error(
      `${envVarName} environment variable is required. ` +
      `Refusing to run without an explicit connection string.`
    )
  }
  if (typeof url !== 'string' || !url.startsWith('postgresql://') && !url.startsWith('postgres://')) {
    throw new Error(`${envVarName} must be a postgresql:// or postgres:// connection string`)
  }
  return url
}

export function requireExplicitWriteApproval(envVarName, opts = {}) {
  const ackVar = opts.ackVar || 'ALLOW_PRODUCTION_WRITE'
  const ackPhrase = opts.ackPhrase || 'I_UNDERSTAND_THIS_WRITES_PRODUCTION'
  const url = requireDbUrl(envVarName)
  const ack = process.env[ackVar]
  if (!ack) {
    throw new Error(
      `${ackVar} environment variable is required before running a write-capable ` +
      `script. Set it to exactly: ${ackPhrase}`
    )
  }
  if (ack !== ackPhrase) {
    throw new Error(
      `${ackVar} must be exactly "${ackPhrase}". ` +
      `Refusing to run with a non-matching acknowledgement value.`
    )
  }
  return url
}
