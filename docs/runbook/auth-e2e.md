# Auth E2E Manual Verification Runbook

Pragmatic curl flows for manually verifying the four primary auth surfaces.
Assumes the server is running at `http://localhost:8000` with insecure cookies enabled.

## Setup

```bash
BASE=http://localhost:8000
ADMIN_USER=admin
ADMIN_PASS=yourpassword
```

---

## 1. Local login → me → logout

```bash
# Login — save cookie jar
curl -sc /tmp/jar.txt -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" | jq .

# Verify session
curl -sb /tmp/jar.txt "$BASE/api/auth/me" | jq .

# Logout — cookie cleared
curl -sc /tmp/jar.txt -X POST "$BASE/api/auth/logout" -b /tmp/jar.txt

# Confirm session gone (expect 401)
curl -sb /tmp/jar.txt "$BASE/api/auth/me"
```

---

## 2. API key issue → use → revoke

```bash
# Login first
curl -sc /tmp/jar.txt -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" -o /dev/null

# Issue a key
PLAINTEXT=$(curl -sb /tmp/jar.txt -X POST "$BASE/api/api-keys" \
  -H 'Content-Type: application/json' \
  -d '{"name":"manual-test"}' | jq -r .plaintext)
KEY_ID=$(curl -sb /tmp/jar.txt "$BASE/api/api-keys" | jq -r '.keys[0].id')

# Use the key (no cookie needed)
curl -H "Authorization: Bearer $PLAINTEXT" "$BASE/api/auth/me" | jq .

# Revoke
curl -sb /tmp/jar.txt -X DELETE "$BASE/api/api-keys/$KEY_ID"

# Confirm revoked (expect 401)
curl -H "Authorization: Bearer $PLAINTEXT" "$BASE/api/auth/me"
```

---

## 3. Trusted-header auth (proxy pass-through)

Requires `COMRADARR_TRUSTED_HEADER_AUTH_ENABLED=true` and
`COMRADARR_TRUSTED_HEADER_AUTH_PROXY_IPS=127.0.0.1/32`.

```bash
# Header from allowed proxy IP — server sees peer=127.0.0.1 (loopback curl)
curl -H "X-Remote-User: alice" "$BASE/api/auth/me" | jq .

# Header from disallowed IP (simulate by expecting 401 from non-loopback)
# This must be tested from a different host or via network namespace tooling.
```

---

## 4. OIDC authorization_code + PKCE-S256

Full OIDC e2e requires a running IdP (Keycloak, Authentik, or the Phase 5
in-process mock). Steps outline:

1. Configure `COMRADARR_OIDC_PROVIDERS` JSON with `client_id`, `client_secret`,
   `discovery_url` pointing at your IdP.
2. `GET $BASE/api/auth/oidc/{provider}/start?return_to=/` — follow the redirect.
3. Authenticate at the IdP UI; IdP redirects to `$BASE/api/auth/oidc/{provider}/callback`.
4. Confirm `comradarr_session` cookie is set; `GET $BASE/api/auth/me` returns
   `auth_provider: "oidc"`.

The automated integration test (`test_phase4_auth_e2e.py::test_oidc_login_flow`)
is skipped until the Phase 5 in-process RS256 mock is wired.
