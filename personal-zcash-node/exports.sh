export APP_ZCASH_NODE_IP="10.21.21.80"
export APP_ZCASH_TOR_PROXY_IP="10.21.22.80"
export APP_ZCASH_P2P_PORT="8233"
export APP_ZCASH_RPC_PORT="8232"
export APP_ZCASH_WALLET_PORT="9067"
export APP_ZCASH_DATA_DIR="${EXPORTS_APP_DIR}/data"

p2p_hidden_service_file="${EXPORTS_TOR_DATA_DIR}/app-${EXPORTS_APP_ID}-p2p/hostname"
rpc_hidden_service_file="${EXPORTS_TOR_DATA_DIR}/app-${EXPORTS_APP_ID}-rpc/hostname"
wallet_hidden_service_file="${EXPORTS_TOR_DATA_DIR}/app-${EXPORTS_APP_ID}-wallet/hostname"

export APP_ZCASH_P2P_HIDDEN_SERVICE="$(cat "${p2p_hidden_service_file}" 2>/dev/null || echo "notyetset.onion")"
export APP_ZCASH_RPC_HIDDEN_SERVICE="$(cat "${rpc_hidden_service_file}" 2>/dev/null || echo "notyetset.onion")"
export APP_ZCASH_WALLET_HIDDEN_SERVICE="$(cat "${wallet_hidden_service_file}" 2>/dev/null || echo "notyetset.onion")"

# Optional: fetch a trusted Tailscale Let's Encrypt cert for Vizor (MagicDNS + HTTPS Certificates).
# Soft-fail if Tailscale is missing or HTTPS is not enabled on the tailnet.
export APP_ZCASH_TAILSCALE_HOSTNAME=""
export APP_ZCASH_TAILSCALE_TLS=""
export APP_ZCASH_LIGHTWALLETD_TLS_CERT=""
export APP_ZCASH_LIGHTWALLETD_TLS_KEY=""

TLS_DIR="${EXPORTS_APP_DIR}/data/lightwalletd/tls"
CERT_PATH="${TLS_DIR}/tailscale.crt"
KEY_PATH="${TLS_DIR}/tailscale.key"
HOST_PATH="${TLS_DIR}/tailscale.hostname"

find_tailscale_container() {
	docker ps --format '{{.Names}}' 2>/dev/null | grep -E '^tailscale(_|-)web(_|-)1$' | head -n1
}

read_tailscale_dns() {
	local container="$1"
	docker exec "$container" tailscale status --json 2>/dev/null | {
		if command -v python3 >/dev/null 2>&1; then
			python3 -c 'import json,sys
try:
  d=json.load(sys.stdin)
  print((d.get("Self") or {}).get("DNSName") or "", end="")
except Exception:
  pass'
		elif command -v jq >/dev/null 2>&1; then
			jq -r '.Self.DNSName // empty'
		else
			tr -d '\n' | sed -n 's/.*"Self"[^{]*{[^}]*"DNSName"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
		fi
	} | tr -d '\r' | sed 's/\.$//'
}

cert_files_ok() {
	[ -s "$CERT_PATH" ] && [ -s "$KEY_PATH" ] || return 1
	grep -q 'BEGIN CERTIFICATE' "$CERT_PATH" 2>/dev/null || return 1
	grep -q 'BEGIN .*PRIVATE KEY' "$KEY_PATH" 2>/dev/null || return 1
	if command -v openssl >/dev/null 2>&1; then
		openssl x509 -in "$CERT_PATH" -noout -checkend 86400 >/dev/null 2>&1 || return 1
	fi
	return 0
}

advertise_tailscale_tls() {
	local dns="$1"
	[ -n "$dns" ] || return 1
	cert_files_ok || return 1
	export APP_ZCASH_TAILSCALE_HOSTNAME="$dns"
	export APP_ZCASH_TAILSCALE_TLS="1"
	# Point lightwalletd at the trusted pair (picked up via LIGHTWALLETD_TLS_*).
	export APP_ZCASH_LIGHTWALLETD_TLS_CERT="/data/lightwalletd/tls/tailscale.crt"
	export APP_ZCASH_LIGHTWALLETD_TLS_KEY="/data/lightwalletd/tls/tailscale.key"
	printf '%s\n' "$dns" >"$HOST_PATH"
	chown 1000:1000 "$HOST_PATH" 2>/dev/null || true
	return 0
}

fetch_tailscale_tls() {
	local container dns tmp_cert tmp_key
	container="$(find_tailscale_container)"
	[ -n "$container" ] || return 1

	dns="$(read_tailscale_dns "$container")"
	[ -n "$dns" ] || return 1

	mkdir -p "$TLS_DIR"
	tmp_cert="/tmp/zcash-lwd.crt"
	tmp_key="/tmp/zcash-lwd.key"

	# Renew when fewer than 30 days remain (720h).
	if ! docker exec "$container" tailscale cert \
		--min-validity=720h \
		--cert-file="$tmp_cert" \
		--key-file="$tmp_key" \
		"$dns" >/dev/null 2>&1; then
		return 1
	fi

	if ! docker cp "${container}:${tmp_cert}" "$CERT_PATH" 2>/dev/null; then
		return 1
	fi
	if ! docker cp "${container}:${tmp_key}" "$KEY_PATH" 2>/dev/null; then
		rm -f "$CERT_PATH"
		return 1
	fi

	docker exec "$container" rm -f "$tmp_cert" "$tmp_key" >/dev/null 2>&1 || true
	chown 1000:1000 "$CERT_PATH" "$KEY_PATH" 2>/dev/null || true
	chmod 644 "$CERT_PATH" 2>/dev/null || true
	chmod 600 "$KEY_PATH" 2>/dev/null || true

	advertise_tailscale_tls "$dns"
}

# Prefer a fresh cert; if Tailscale is down, keep advertising a still-valid on-disk cert.
if ! fetch_tailscale_tls; then
	cached_dns="$(tr -d '\r\n' <"$HOST_PATH" 2>/dev/null || true)"
	advertise_tailscale_tls "$cached_dns" || true
fi
