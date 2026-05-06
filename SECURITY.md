# Security

## References

- [Cloudflare MCP Security Guide](https://github.com/cloudflare/agents/blob/main/docs/securing-mcp-servers.md)
- [MCP Authorization Spec](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP Security Best Practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)
- [RFC 9700 - OAuth 2.0 Security Best Practices](https://www.rfc-editor.org/rfc/rfc9700)

---

## Implemented

- **OAuth redirect URI validation** -- exact string matching against registered values, no wildcards. Handled by
  `workers-oauth-provider`.
- **CSRF protection** -- random token in a `__Host-` secure cookie, validated on POST, single-use, 10-minute expiration.
- **PKCE** -- public clients use PKCE (`S256`) to prevent authorization code interception. Handled by
  `workers-oauth-provider` (OAuth 2.1 compliant).
- **Input sanitization** -- all client metadata in the consent dialog (name, scopes, URIs) is HTML-escaped and
  URL-validated via `sanitizeText` / `sanitizeUrl`.
- **Content Security Policy** -- restrictive CSP on the consent dialog (`default-src 'none'`, whitelisted `style-src`,
  `img-src`, `script-src`, `connect-src`, `base-uri`, `frame-ancestors 'none'`).
    - `style-src 'unsafe-inline'` is present for the inline `<style>` block.
    - `form-action` is intentionally omitted: it caused silent submission failures on some origins (Cloudflare
      workers.dev). CSRF protection (token + cookie) already covers form submission security.
- **No inline JavaScript** -- the consent dialog uses data attributes only.
- **OAuth state management** -- cryptographically random state stored in KV with a 10-minute TTL, bound to the browser
  session via a hashed cookie, single-use and deleted after validation.
- **Per-client consent registry** -- first-time clients require explicit user approval via a consent dialog; approved
  clients are stored with an HMAC-signed cookie.
- **Cookie security** -- all auth cookies use the `__Host-` prefix with `Secure`, `HttpOnly`, `SameSite=Lax`, and no
  `Domain` attribute.
- **Token passthrough prevention** -- the GitHub OAuth token is issued independently during the callback flow and never
  forwarded from the MCP client.
- **Tool-level authorization** -- `ALLOWED_USERNAMES` is checked inside `init()`, so unauthorized users get no tools
  even if they complete OAuth.
- **HTTPS enforcement** -- Cloudflare Workers enforce HTTPS on all endpoints; callback URIs are always HTTPS.
- **Session security** -- session binding uses a SHA-256 hash of the state token; authentication is token-based, not
  session-based.
- **Open redirector prevention** -- all redirect targets are validated by `workers-oauth-provider`.

---

## Can be improved

- **OAuth scope** -- the current GitHub OAuth App requests `repo` scope, which grants access to all repositories. The
  restriction to the data repo is enforced by code, not by the token. Using
  a [GitHub fine-grained personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token)
  scoped exclusively to the data repository would be tighter.
