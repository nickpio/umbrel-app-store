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
