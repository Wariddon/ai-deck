// Inspect terminal engine errors only. Assistant text and tool failures are not
// evidence that the provider account has signed out.
function authenticationConnection(connection, result) {
  if (!connection || result?.status !== "failed" || typeof result.error !== "string") return connection;
  const error = result.error.slice(0, 8000);
  const expired = /failed to authenticate:\s*OAuth session expired and could not be refreshed/iu.test(error)
    || /(?:refresh token|OAuth token).{0,100}(?:expired|revoked|invalid).{0,100}(?:sign in|log in|login|authenticate)/isu.test(error)
    || /(?:401\s+Unauthorized|authentication_error).{0,100}(?:invalid|expired|missing).{0,40}(?:API key|token|credential)/isu.test(error);
  if (!expired) return connection;
  return { ...connection, status: "signIn", authError: "The provider rejected this sign-in. Sign in again in Connections, then refresh. Your chat is kept; AI Deck will not resend automatically." };
}

module.exports = { authenticationConnection };
