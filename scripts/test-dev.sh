#!/usr/bin/env bash
#
# Test Development Server for Comradarr
# ======================================
#
# Launches a SvelteKit development server with an isolated PostgreSQL database
# for testing and development purposes.
#
# Usage:
#   ./scripts/test-dev.sh                    # Ephemeral mode (auto-cleanup)
#   ./scripts/test-dev.sh --persist          # Prompt before cleanup
#   ./scripts/test-dev.sh --db-name mydb     # Use specific database name
#   ./scripts/test-dev.sh --help             # Show usage information
#
# Non-interactive sudo (Linux only):
#   SUDO_PASSWORD='...' ./scripts/test-dev.sh           # Via environment (recommended)
#   echo 'pass' | ./scripts/test-dev.sh --sudo-stdin    # Via stdin pipe
#   ./scripts/test-dev.sh --sudo-password 'pass'        # Via argument (insecure)
#
# Requirements:
#   - bun installed
#   - PostgreSQL installed and running
#   - psql and pg_isready available

set -euo pipefail

# -----------------------------------------------------------------------------
# Script Directory
# -----------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# -----------------------------------------------------------------------------
# Default Configuration
# -----------------------------------------------------------------------------
STATE_FILE="/tmp/comradarr-dev-state.json"
PERSIST_MODE=false
DEV_PORT=5173
DB_PORT=5432
DB_HOST=localhost
LOG_ENABLED=true
LOG_FILE=""
CUSTOM_DB_NAME=""
CUSTOM_ADMIN_PASSWORD=""
SUDO_PASSWORD_ARG=""  # Password from --sudo-password argument
SUDO_FROM_STDIN=false # Whether to read password from stdin
SKIP_AUTH=false       # Enable local network bypass authentication

# Reconnect mode configuration
RECONNECT_MODE=false
RECONNECT_DB_NAME=""
PROVIDED_DB_PASSWORD=""
PROVIDED_SECRET_KEY=""
PERSISTENT_DBS_FILE="$SCRIPT_DIR/.comradarr-dev-dbs.json"

# Generated values (set during initialization)
DB_NAME=""
DB_USER=""
DB_PASSWORD=""
DB_PASSWORD_ENCODED=""  # URL-encoded version for connection strings
ADMIN_PASSWORD=""
SECRET_KEY=""
TIMESTAMP=""

# Runtime state
DEV_SERVER_PID=""
SUDO_REFRESH_PID=""
CLEANUP_DONE=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# -----------------------------------------------------------------------------
# OS Detection (from test-db.sh)
# -----------------------------------------------------------------------------
detect_os() {
    case "$(uname -s)" in
        Darwin) echo "macos" ;;
        Linux)  echo "linux" ;;
        *)      echo "unsupported" ;;
    esac
}

OS_TYPE="$(detect_os)"

# -----------------------------------------------------------------------------
# Helper Functions
# -----------------------------------------------------------------------------
log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1" >&2; }

# Generate random string (alphanumeric, lowercase)
# Note: || true prevents SIGPIPE from causing script exit with pipefail
generate_random_string() {
    local length="${1:-16}"
    (LC_ALL=C tr -dc 'a-z0-9' < /dev/urandom | head -c "$length") || true
}

# Generate random password (mixed case, numbers, symbols)
# Note: || true prevents SIGPIPE from causing script exit with pipefail
generate_password() {
    local length="${1:-24}"
    (LC_ALL=C tr -dc 'A-Za-z0-9!@#$%^&*' < /dev/urandom | head -c "$length") || true
}

# Generate hex secret key (256-bit for AES-256-GCM)
# Note: || true prevents SIGPIPE from causing script exit with pipefail
generate_secret_key() {
    (LC_ALL=C tr -dc 'a-f0-9' < /dev/urandom | head -c 64) || true
}

# URL-encode a string for safe inclusion in connection URLs
# Encodes all reserved characters that could break URL parsing
urlencode() {
    local string="$1"
    local encoded=""
    local char
    for (( i=0; i<${#string}; i++ )); do
        char="${string:i:1}"
        case "$char" in
            [A-Za-z0-9._~-])
                encoded+="$char"
                ;;
            *)
                # Convert character to hex escape sequence
                encoded+=$(printf '%%%02X' "'$char")
                ;;
        esac
    done
    echo "$encoded"
}

# Execute SQL as superuser (handles platform differences)
# On Linux, uses Unix socket (peer auth) - no -h/-p flags needed
# On macOS, uses TCP connection to Homebrew PostgreSQL
run_psql_superuser() {
    local sql="$1"
    local db="${2:-postgres}"

    if [[ "$OS_TYPE" == "macos" ]]; then
        psql -h "$DB_HOST" -p "$DB_PORT" -d "$db" -c "$sql"
    else
        sudo -n -u postgres psql -p "$DB_PORT" ${db:+-d "$db"} -c "$sql"
    fi
}

# Execute SQL quietly
run_psql_superuser_quiet() {
    local sql="$1"
    local db="${2:-postgres}"

    if [[ "$OS_TYPE" == "macos" ]]; then
        psql -h "$DB_HOST" -p "$DB_PORT" -d "$db" -q -c "$sql" 2>/dev/null
    else
        sudo -n -u postgres psql -p "$DB_PORT" ${db:+-d "$db"} -q -c "$sql" 2>/dev/null
    fi
}

# List databases
list_databases() {
    if [[ "$OS_TYPE" == "macos" ]]; then
        psql -h "$DB_HOST" -p "$DB_PORT" -d postgres -lqt 2>/dev/null
    else
        sudo -n -u postgres psql -p "$DB_PORT" -lqt 2>/dev/null
    fi
}

# Check if database exists
database_exists() {
    list_databases | cut -d \| -f 1 | grep -qw "$1"
}

# -----------------------------------------------------------------------------
# Persistent Credential Storage Functions
# -----------------------------------------------------------------------------

# Save database credentials to persistent storage
save_db_credentials() {
    local db_name="$1"
    local db_password="$2"
    local secret_key="$3"
    local admin_password="$4"

    # Create file if it doesn't exist
    if [[ ! -f "$PERSISTENT_DBS_FILE" ]]; then
        echo '{}' > "$PERSISTENT_DBS_FILE"
        chmod 600 "$PERSISTENT_DBS_FILE"
    fi

    # Use jq to add/update the database entry
    local temp_file
    temp_file=$(mktemp)
    jq --arg db "$db_name" \
       --arg pwd "$db_password" \
       --arg key "$secret_key" \
       --arg admin "$admin_password" \
       --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
       '.[$db] = {"password": $pwd, "secretKey": $key, "adminPassword": $admin, "savedAt": $ts}' \
       "$PERSISTENT_DBS_FILE" > "$temp_file" && mv "$temp_file" "$PERSISTENT_DBS_FILE"

    chmod 600 "$PERSISTENT_DBS_FILE"
}

# Load database credentials from persistent storage
# Returns: sets DB_PASSWORD, SECRET_KEY, ADMIN_PASSWORD or returns 1 if not found
load_db_credentials() {
    local db_name="$1"

    if [[ ! -f "$PERSISTENT_DBS_FILE" ]]; then
        return 1
    fi

    # Check if database exists in storage
    if ! jq -e --arg db "$db_name" '.[$db]' "$PERSISTENT_DBS_FILE" &>/dev/null; then
        return 1
    fi

    # Extract credentials
    DB_PASSWORD=$(jq -r --arg db "$db_name" '.[$db].password' "$PERSISTENT_DBS_FILE")
    SECRET_KEY=$(jq -r --arg db "$db_name" '.[$db].secretKey' "$PERSISTENT_DBS_FILE")
    ADMIN_PASSWORD=$(jq -r --arg db "$db_name" '.[$db].adminPassword // "(unknown)"' "$PERSISTENT_DBS_FILE")

    return 0
}

# List all saved databases
list_saved_databases() {
    if [[ ! -f "$PERSISTENT_DBS_FILE" ]]; then
        return
    fi
    jq -r 'keys[]' "$PERSISTENT_DBS_FILE" 2>/dev/null
}

# Remove database from persistent storage
remove_db_credentials() {
    local db_name="$1"

    if [[ ! -f "$PERSISTENT_DBS_FILE" ]]; then
        return
    fi

    local temp_file
    temp_file=$(mktemp)
    jq --arg db "$db_name" 'del(.[$db])' "$PERSISTENT_DBS_FILE" > "$temp_file" && \
        mv "$temp_file" "$PERSISTENT_DBS_FILE"
}

# -----------------------------------------------------------------------------
# Validation Functions
# -----------------------------------------------------------------------------

# Prompt for sudo password upfront and cache credentials (Linux only)
# This ensures all subsequent sudo commands work without re-prompting
#
# Supports multiple authentication methods (in priority order):
#   1. --sudo-password argument (insecure, shows warning)
#   2. SUDO_PASSWORD environment variable (recommended for CI/CD)
#   3. --sudo-stdin flag to read from stdin pipe
#   4. Pre-cached credentials (existing sudo -n behavior)
#   5. Interactive prompt (original behavior, fails for automation)
prompt_sudo_upfront() {
    if [[ "$OS_TYPE" != "linux" ]]; then
        return 0
    fi

    # Check if we already have valid sudo credentials cached
    if sudo -n true 2>/dev/null; then
        return 0
    fi

    local password=""

    # Priority 1: Command-line argument (least secure, but user requested)
    if [[ -n "$SUDO_PASSWORD_ARG" ]]; then
        log_warn "Using --sudo-password is insecure (visible in ps output)"
        password="$SUDO_PASSWORD_ARG"
    fi

    # Priority 2: Environment variable (secure, recommended for CI/CD)
    if [[ -z "$password" ]] && [[ -n "${SUDO_PASSWORD:-}" ]]; then
        password="$SUDO_PASSWORD"
    fi

    # Priority 3: Stdin if flag is set
    if [[ -z "$password" ]] && [[ "$SUDO_FROM_STDIN" == "true" ]]; then
        if [[ -t 0 ]]; then
            log_error "--sudo-stdin specified but stdin is a terminal (no pipe detected)"
            exit 1
        fi
        read -r password
    fi

    # If we have a password from any method, try to cache credentials
    if [[ -n "$password" ]]; then
        log_info "Caching sudo credentials (non-interactive)..."
        if ! printf '%s\n' "$password" | sudo -S -v 2>/dev/null; then
            log_error "Failed to authenticate with provided sudo password"
            exit 1
        fi
        # Clear password variables for security
        unset SUDO_PASSWORD
        SUDO_PASSWORD_ARG=""
    else
        # No automated password available - fail for non-interactive use
        log_error "Sudo credentials required but not cached."
        echo ""
        echo "For non-interactive use, provide credentials via:"
        echo "  1. Environment variable: SUDO_PASSWORD='...' $0"
        echo "  2. Stdin pipe: echo 'password' | $0 --sudo-stdin"
        echo "  3. Command-line: $0 --sudo-password 'password' (insecure)"
        echo "  4. Pre-cache: sudo -v && $0"
        echo ""
        exit 1
    fi

    # Start a background process to keep sudo credentials fresh
    # This prevents timeout during long-running operations
    (
        while true; do
            sudo -n true 2>/dev/null
            sleep 50
        done
    ) &
    SUDO_REFRESH_PID=$!

    log_success "Sudo credentials cached"
}

check_requirements() {
    local missing=()

    if ! command -v bun &> /dev/null; then
        missing+=("bun")
    fi
    if ! command -v psql &> /dev/null; then
        missing+=("psql (PostgreSQL client)")
    fi
    if ! command -v pg_isready &> /dev/null; then
        missing+=("pg_isready")
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing required tools: ${missing[*]}"
        log_info "Please install the missing tools and try again."
        exit 1
    fi
}

check_postgres_running() {
    if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" &> /dev/null; then
        log_error "PostgreSQL is not running on ${DB_HOST}:${DB_PORT}"
        log_info "Start PostgreSQL with: ./scripts/test-db.sh start"
        exit 1
    fi
}

check_port_available() {
    local port="$1"
    if lsof -Pi :"$port" -sTCP:LISTEN -t &> /dev/null; then
        log_error "Port $port is already in use"
        log_info "Use --port <port> to specify a different port"
        exit 1
    fi
}

check_superuser_access() {
    log_info "Checking PostgreSQL superuser access..."

    if [[ "$OS_TYPE" == "macos" ]]; then
        # On macOS with Homebrew, the current user typically has superuser access
        if ! psql -h "$DB_HOST" -p "$DB_PORT" -d postgres -c '\q' &> /dev/null; then
            log_error "Cannot connect to PostgreSQL. Check PostgreSQL installation."
            exit 1
        fi
    else
        # On Linux, sudo credentials should already be cached from prompt_sudo_upfront
        # Use sudo -n (non-interactive) since we've already prompted
        if ! sudo -n -u postgres psql -p "$DB_PORT" -c '\q' &> /dev/null; then
            log_error "Cannot connect to PostgreSQL as superuser."
            echo ""
            echo "Sudo credentials may have expired or the postgres user cannot run psql."
            echo "Please ensure PostgreSQL is installed and the postgres system user exists."
            echo ""
            exit 1
        fi
    fi

    log_success "PostgreSQL superuser access verified"
}

# -----------------------------------------------------------------------------
# Reconnect Mode Functions
# -----------------------------------------------------------------------------

# Prompt for reconnect credentials (or load from persistent storage)
prompt_reconnect_credentials() {
    # First try to load from persistent storage
    if load_db_credentials "$RECONNECT_DB_NAME"; then
        log_success "Loaded saved credentials for '${RECONNECT_DB_NAME}'"
        DB_PASSWORD_ENCODED="$(urlencode "$DB_PASSWORD")"
        return 0
    fi

    log_info "No saved credentials found for '${RECONNECT_DB_NAME}'"

    # Prompt for DB password if not provided via CLI
    if [[ -z "$PROVIDED_DB_PASSWORD" ]]; then
        echo -e "${YELLOW}Database password required for reconnection${NC}"
        echo -n "Enter database password for '${RECONNECT_DB_NAME}': "
        read -rs PROVIDED_DB_PASSWORD
        echo ""
        if [[ -z "$PROVIDED_DB_PASSWORD" ]]; then
            log_error "Database password is required"
            exit 1
        fi
    fi
    DB_PASSWORD="$PROVIDED_DB_PASSWORD"
    DB_PASSWORD_ENCODED="$(urlencode "$DB_PASSWORD")"

    # Prompt for SECRET_KEY if not provided via CLI
    if [[ -z "$PROVIDED_SECRET_KEY" ]]; then
        echo -e "${YELLOW}SECRET_KEY required for reconnection${NC}"
        echo -n "Enter SECRET_KEY (64 hex chars): "
        read -rs PROVIDED_SECRET_KEY
        echo ""
        if [[ -z "$PROVIDED_SECRET_KEY" ]]; then
            log_error "SECRET_KEY is required"
            exit 1
        fi
    fi
    SECRET_KEY="$PROVIDED_SECRET_KEY"
    ADMIN_PASSWORD="(unknown)"
}

# Validate database connection for reconnect mode
validate_reconnect_database() {
    log_info "Validating database connection for '${DB_NAME}'..."

    # Check database exists
    if ! database_exists "$DB_NAME"; then
        log_error "Database '${DB_NAME}' does not exist"
        echo ""
        echo "Available comradarr_dev_* databases in PostgreSQL:"
        list_databases | cut -d \| -f 1 | grep -E '^\s*comradarr_dev_' | sed 's/^[[:space:]]*/  /' || echo "  (none found)"
        echo ""
        echo "Databases with saved credentials:"
        list_saved_databases | sed 's/^/  /' || echo "  (none saved)"
        echo ""
        exit 1
    fi

    # Test connection with provided credentials
    if ! PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c '\q' &>/dev/null; then
        log_error "Failed to connect to database '${DB_NAME}'"
        echo "Check that the password is correct."
        exit 1
    fi

    # Validate SECRET_KEY format (64 hex characters)
    if ! [[ "$SECRET_KEY" =~ ^[a-f0-9]{64}$ ]]; then
        log_error "Invalid SECRET_KEY format (must be 64 lowercase hex characters)"
        exit 1
    fi

    log_success "Database connection validated"
}

# Initialize configuration for reconnect mode
initialize_reconnect_config() {
    DB_NAME="$RECONNECT_DB_NAME"
    DB_USER="$RECONNECT_DB_NAME"
    PERSIST_MODE=true

    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    if [[ "$LOG_ENABLED" == "true" ]] && [[ -z "$LOG_FILE" ]]; then
        LOG_FILE="/tmp/comradarr-test-dev-${TIMESTAMP}.log"
    fi
}

# -----------------------------------------------------------------------------
# Database Setup Functions
# -----------------------------------------------------------------------------
setup_database() {
    log_info "Setting up isolated database '${DB_NAME}'..."

    # Create database user if it doesn't exist
    run_psql_superuser_quiet "
        DO \$\$
        BEGIN
            IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${DB_USER}') THEN
                CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASSWORD}';
            ELSE
                ALTER ROLE ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';
            END IF;
        END
        \$\$;
    "

    # Drop existing database if it exists (should not happen with random names)
    if database_exists "$DB_NAME"; then
        log_warn "Database '${DB_NAME}' already exists, dropping..."
        run_psql_superuser "DROP DATABASE ${DB_NAME};"
    fi

    # Create database
    run_psql_superuser "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"

    # Grant privileges
    run_psql_superuser "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"
    run_psql_superuser "GRANT ALL ON SCHEMA public TO ${DB_USER};" "$DB_NAME"

    log_success "Database '${DB_NAME}' created"
}

run_migrations() {
    log_info "Running database migrations..."

    cd "$PROJECT_ROOT"
    DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD_ENCODED}@${DB_HOST}:${DB_PORT}/${DB_NAME}" \
    SECRET_KEY="$SECRET_KEY" \
    bunx drizzle-kit migrate

    log_success "Migrations completed"
}

create_admin_user() {
    log_info "Creating admin user..."

    cd "$PROJECT_ROOT"

    # Use the permanent create-admin.ts script in the scripts directory
    # This avoids Bun crashes when running TypeScript from temp directories
    # (native modules like @node-rs/argon2 require proper module resolution)
    DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD_ENCODED}@${DB_HOST}:${DB_PORT}/${DB_NAME}" \
    SECRET_KEY="$SECRET_KEY" \
    ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    bun "$SCRIPT_DIR/create-admin.ts"

    log_success "Admin user created"
}

configure_skip_auth() {
    if [[ "$SKIP_AUTH" != "true" ]]; then
        return
    fi

    log_info "Configuring authentication bypass (local_bypass mode)..."

    # Insert auth_mode setting into app_settings table
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q -c "
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ('auth_mode', 'local_bypass', NOW())
        ON CONFLICT (key) DO UPDATE SET value = 'local_bypass', updated_at = NOW();
    "

    log_success "Authentication bypass enabled (no login required)"
}

# -----------------------------------------------------------------------------
# State File Functions
# -----------------------------------------------------------------------------
write_state_file() {
    log_info "Writing state file to ${STATE_FILE}..."

    cat > "$STATE_FILE" << EOF
{
  "version": "1.0",
  "pid": ${DEV_SERVER_PID},
  "port": ${DEV_PORT},
  "dbName": "${DB_NAME}",
  "dbUser": "${DB_USER}",
  "dbPassword": "${DB_PASSWORD}",
  "dbHost": "${DB_HOST}",
  "dbPort": ${DB_PORT},
  "logFile": "${LOG_FILE:-}",
  "persistMode": ${PERSIST_MODE},
  "reconnectMode": ${RECONNECT_MODE},
  "sudoRefreshPid": ${SUDO_REFRESH_PID:-0},
  "secretKey": "${SECRET_KEY}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "skipAuth": ${SKIP_AUTH}
}
EOF

    chmod 600 "$STATE_FILE"
    log_success "State file created"
}

# -----------------------------------------------------------------------------
# Cleanup Functions
# -----------------------------------------------------------------------------
cleanup() {
    if [[ "$CLEANUP_DONE" == "true" ]]; then
        return
    fi
    CLEANUP_DONE=true

    echo ""
    log_info "Shutting down..."

    # Stop dev server if running
    if [[ -n "$DEV_SERVER_PID" ]] && kill -0 "$DEV_SERVER_PID" 2>/dev/null; then
        log_info "Stopping dev server (PID: $DEV_SERVER_PID)..."
        kill "$DEV_SERVER_PID" 2>/dev/null || true
        wait "$DEV_SERVER_PID" 2>/dev/null || true
    fi

    # Stop sudo refresh background process if running
    if [[ -n "$SUDO_REFRESH_PID" ]] && kill -0 "$SUDO_REFRESH_PID" 2>/dev/null; then
        kill "$SUDO_REFRESH_PID" 2>/dev/null || true
    fi

    # Handle reconnect mode - always preserve database
    if [[ "$RECONNECT_MODE" == "true" ]]; then
        echo ""
        log_success "Database '${DB_NAME}' preserved (reconnect mode)"
        echo ""
        echo "To reconnect again:"
        echo "  ./scripts/test-dev.sh --reconnect ${DB_NAME}"
        echo ""
        # Only remove state file and log file
        rm -f "$STATE_FILE"
        if [[ -n "$LOG_FILE" ]] && [[ -f "$LOG_FILE" ]]; then
            rm -f "$LOG_FILE"
        fi
        return
    fi

    # Handle persist mode
    if [[ "$PERSIST_MODE" == "true" ]]; then
        echo ""
        read -r -p "Keep database and logs? (y/N) " response
        if [[ "${response,,}" == "y" ]]; then
            echo ""
            log_success "Resources preserved!"
            echo ""
            echo -e "${CYAN}${BOLD}=== Preserved Resources ===${NC}"
            echo -e "Database: ${GREEN}postgres://${DB_USER}:${DB_PASSWORD_ENCODED}@${DB_HOST}:${DB_PORT}/${DB_NAME}${NC}"
            echo -e "Admin Login: ${GREEN}admin / ${ADMIN_PASSWORD}${NC}"
            if [[ -n "$LOG_FILE" ]] && [[ -f "$LOG_FILE" ]]; then
                echo -e "Log File: ${GREEN}${LOG_FILE}${NC}"
            fi
            echo ""
            echo "To reuse this database:"
            echo "  ./scripts/test-dev.sh --reconnect ${DB_NAME}"
            echo ""
            echo "Or manually:"
            echo "  export DATABASE_URL='postgres://${DB_USER}:${DB_PASSWORD_ENCODED}@${DB_HOST}:${DB_PORT}/${DB_NAME}'"
            echo "  export SECRET_KEY='${SECRET_KEY}'"
            echo "  bun run dev --port ${DEV_PORT}"
            echo ""
            return
        fi
    fi

    # Clean up resources
    cleanup_resources
}

cleanup_resources() {
    log_info "Cleaning up resources..."

    # Remove state file
    if [[ -f "$STATE_FILE" ]]; then
        rm -f "$STATE_FILE"
    fi

    # Drop database
    if database_exists "$DB_NAME" 2>/dev/null; then
        log_info "Dropping database '${DB_NAME}'..."
        run_psql_superuser "DROP DATABASE ${DB_NAME};" 2>/dev/null || true
    fi

    # Drop database user (matches DB_NAME for isolation)
    # Note: DB_USER is set to match DB_NAME in initialize_config
    if [[ -n "$DB_USER" ]]; then
        log_info "Dropping database user '${DB_USER}'..."
        run_psql_superuser "DROP ROLE IF EXISTS ${DB_USER};" 2>/dev/null || true
    fi

    # Remove saved credentials when database is dropped
    if [[ -n "$DB_NAME" ]]; then
        remove_db_credentials "$DB_NAME"
    fi

    # Remove log file
    if [[ -n "$LOG_FILE" ]] && [[ -f "$LOG_FILE" ]]; then
        log_info "Removing log file..."
        rm -f "$LOG_FILE"
    fi

    log_success "Cleanup complete"
}


# -----------------------------------------------------------------------------
# Display Functions
# -----------------------------------------------------------------------------
display_banner() {
    local mode_label
    if [[ "$RECONNECT_MODE" == "true" ]]; then
        mode_label="${CYAN}Reconnected${NC}"
    elif [[ "$PERSIST_MODE" == "true" ]]; then
        mode_label="${YELLOW}Persistent${NC}"
    else
        mode_label="${GREEN}Ephemeral${NC}"
    fi

    echo ""
    echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}${BOLD}║           Comradarr Test Development Server                      ║${NC}"
    echo -e "${CYAN}${BOLD}╠══════════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${CYAN}${BOLD}║${NC} Mode:        ${mode_label}"
    echo -e "${CYAN}${BOLD}║${NC} Dev Server:  ${GREEN}http://localhost:${DEV_PORT}${NC}"
    echo -e "${CYAN}${BOLD}║${NC} Database:    ${GREEN}postgres://${DB_USER}:${DB_PASSWORD_ENCODED}@${DB_HOST}:${DB_PORT}/${DB_NAME}${NC}"
    if [[ "$RECONNECT_MODE" == "true" ]]; then
        if [[ "$ADMIN_PASSWORD" == "(unknown)" ]]; then
            echo -e "${CYAN}${BOLD}║${NC} Admin Login: ${GREEN}admin${NC} / ${YELLOW}(use saved password)${NC}"
        else
            echo -e "${CYAN}${BOLD}║${NC} Admin Login: ${GREEN}admin${NC} / ${GREEN}${ADMIN_PASSWORD}${NC}"
        fi
    elif [[ "$SKIP_AUTH" == "true" ]]; then
        echo -e "${CYAN}${BOLD}║${NC} Auth:        ${YELLOW}Skipped${NC} (local bypass enabled)"
    else
        echo -e "${CYAN}${BOLD}║${NC} Admin Login: ${GREEN}admin${NC} / ${GREEN}${ADMIN_PASSWORD}${NC}"
    fi
    if [[ "$LOG_ENABLED" == "true" ]] && [[ -n "$LOG_FILE" ]]; then
        echo -e "${CYAN}${BOLD}║${NC} Log File:    ${GREEN}${LOG_FILE}${NC}"
    fi
    echo -e "${CYAN}${BOLD}╠══════════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${CYAN}${BOLD}║${NC} Press ${YELLOW}Ctrl-C${NC} to stop"
    echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# -----------------------------------------------------------------------------
# Dev Server Functions
# -----------------------------------------------------------------------------
start_dev_server() {
    log_info "Starting SvelteKit dev server on port ${DEV_PORT}..."

    cd "$PROJECT_ROOT"

    # Export environment variables
    export DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD_ENCODED}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
    export SECRET_KEY="$SECRET_KEY"

    if [[ "$LOG_ENABLED" == "true" ]] && [[ -n "$LOG_FILE" ]]; then
        # Log to both console and file
        bun run dev --port "$DEV_PORT" 2>&1 | tee -a "$LOG_FILE" &
    else
        # Console only
        bun run dev --port "$DEV_PORT" &
    fi
    DEV_SERVER_PID=$!

    # Wait a moment for server to start
    sleep 2

    # Verify server started
    if ! kill -0 "$DEV_SERVER_PID" 2>/dev/null; then
        log_error "Dev server failed to start"
        cleanup_resources
        exit 1
    fi

    log_success "Dev server started (PID: $DEV_SERVER_PID)"
}

# -----------------------------------------------------------------------------
# Argument Parsing
# -----------------------------------------------------------------------------
parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --persist)
                PERSIST_MODE=true
                shift
                ;;
            --db-name)
                if [[ -z "${2:-}" ]]; then
                    log_error "--db-name requires a value"
                    exit 1
                fi
                CUSTOM_DB_NAME="$2"
                PERSIST_MODE=true  # Named database implies persist
                shift 2
                ;;
            --admin-password)
                if [[ -z "${2:-}" ]]; then
                    log_error "--admin-password requires a value"
                    exit 1
                fi
                CUSTOM_ADMIN_PASSWORD="$2"
                shift 2
                ;;
            --log-file)
                if [[ -z "${2:-}" ]]; then
                    log_error "--log-file requires a value"
                    exit 1
                fi
                LOG_FILE="$2"
                shift 2
                ;;
            --port)
                if [[ -z "${2:-}" ]]; then
                    log_error "--port requires a value"
                    exit 1
                fi
                DEV_PORT="$2"
                shift 2
                ;;
            --db-port)
                if [[ -z "${2:-}" ]]; then
                    log_error "--db-port requires a value"
                    exit 1
                fi
                DB_PORT="$2"
                shift 2
                ;;
            --no-logs)
                LOG_ENABLED=false
                shift
                ;;
            --sudo-password)
                if [[ -z "${2:-}" ]]; then
                    log_error "--sudo-password requires a value"
                    exit 1
                fi
                SUDO_PASSWORD_ARG="$2"
                shift 2
                ;;
            --sudo-stdin)
                SUDO_FROM_STDIN=true
                shift
                ;;
            --skip-auth)
                SKIP_AUTH=true
                shift
                ;;
            --reconnect)
                if [[ -z "${2:-}" ]]; then
                    log_error "--reconnect requires a database name"
                    exit 1
                fi
                RECONNECT_MODE=true
                RECONNECT_DB_NAME="$2"
                shift 2
                ;;
            --db-password)
                if [[ -z "${2:-}" ]]; then
                    log_error "--db-password requires a value"
                    exit 1
                fi
                PROVIDED_DB_PASSWORD="$2"
                shift 2
                ;;
            --secret-key)
                if [[ -z "${2:-}" ]]; then
                    log_error "--secret-key requires a value"
                    exit 1
                fi
                PROVIDED_SECRET_KEY="$2"
                shift 2
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                echo "Run './scripts/test-dev.sh --help' for usage."
                exit 1
                ;;
        esac
    done
}


# -----------------------------------------------------------------------------
# Help Function
# -----------------------------------------------------------------------------
show_help() {
    cat << 'EOF'
Test Development Server for Comradarr
======================================

Launches a SvelteKit development server with an isolated PostgreSQL database
for testing and development purposes.

USAGE:
    ./scripts/test-dev.sh [OPTIONS]

MODES:
    Default (Ephemeral)
        Creates a temporary database with random credentials.
        All resources are automatically cleaned up on exit.

    Persistent (--persist)
        Same setup as default, but prompts before cleanup.
        Choose to keep or discard database and logs on exit.

OPTIONS:
    --persist               Prompt before cleanup on exit
    --db-name <name>        Use specific database name (implies --persist)
    --admin-password <pwd>  Use specific admin password instead of random
    --log-file <path>       Custom log file path
    --port <port>           Dev server port (default: 5173)
    --db-port <port>        PostgreSQL port (default: 5432)
    --no-logs               Disable log file creation (console only)
    --skip-auth             Skip authentication (enables local network bypass)
    --help, -h              Show this help message

RECONNECT OPTIONS:
    --reconnect <db_name>   Reconnect to an existing persistent database
    --db-password <pwd>     Database password (auto-loaded or prompts if not saved)
    --secret-key <key>      SECRET_KEY for encryption (auto-loaded or prompts if not saved)

    When using --db-name, credentials are automatically saved to
    scripts/.comradarr-dev-dbs.json for future reconnection.

SUDO OPTIONS (Linux only):
    --sudo-password <pwd>   Provide sudo password (INSECURE: visible in ps)
    --sudo-stdin            Read sudo password from stdin (for piped input)

    For non-interactive/automated use, provide sudo password via:
      - Environment: SUDO_PASSWORD='...' ./scripts/test-dev.sh (recommended)
      - Stdin pipe:  echo 'password' | ./scripts/test-dev.sh --sudo-stdin
      - Argument:    ./scripts/test-dev.sh --sudo-password 'pwd' (insecure)
      - Pre-cached:  sudo -v && ./scripts/test-dev.sh

EXAMPLES:
    # Quick ephemeral development session
    ./scripts/test-dev.sh

    # Persistent database for multi-session development
    ./scripts/test-dev.sh --persist

    # Named database for repeatable setup (credentials auto-saved)
    ./scripts/test-dev.sh --db-name my_feature_db

    # Reconnect to existing database (credentials auto-loaded)
    ./scripts/test-dev.sh --reconnect my_feature_db

    # Reconnect with explicit credentials
    ./scripts/test-dev.sh --reconnect comradarr_dev_abc123 \
        --db-password "password" --secret-key "64hexchars..."

    # Custom ports
    ./scripts/test-dev.sh --port 3000 --db-port 5433

    # Fixed admin password for automation
    ./scripts/test-dev.sh --admin-password mysecretpassword

    # Non-interactive with sudo password (Linux, CI/CD)
    SUDO_PASSWORD="sudopass" ./scripts/test-dev.sh

    # Non-interactive via stdin pipe (Linux)
    echo "sudopass" | ./scripts/test-dev.sh --sudo-stdin

REQUIREMENTS:
    - bun installed (https://bun.sh)
    - PostgreSQL installed and running
    - psql and pg_isready available in PATH

EOF
}

# -----------------------------------------------------------------------------
# Initialization
# -----------------------------------------------------------------------------
initialize_config() {
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)

    # Set database name
    if [[ -n "$CUSTOM_DB_NAME" ]]; then
        DB_NAME="$CUSTOM_DB_NAME"
    else
        DB_NAME="comradarr_dev_$(generate_random_string 8)"
    fi

    # Database user matches database name for isolation
    DB_USER="$DB_NAME"

    # Generate or use provided passwords
    DB_PASSWORD="$(generate_password 16)"
    DB_PASSWORD_ENCODED="$(urlencode "$DB_PASSWORD")"

    if [[ -n "$CUSTOM_ADMIN_PASSWORD" ]]; then
        ADMIN_PASSWORD="$CUSTOM_ADMIN_PASSWORD"
    else
        ADMIN_PASSWORD="$(generate_password 16)"
    fi

    # Generate secret key
    SECRET_KEY="$(generate_secret_key)"

    # Set log file path if logging enabled and not specified
    if [[ "$LOG_ENABLED" == "true" ]] && [[ -z "$LOG_FILE" ]]; then
        LOG_FILE="/tmp/comradarr-test-dev-${TIMESTAMP}.log"
    fi

    # Save credentials for named databases (for future reconnection)
    if [[ -n "$CUSTOM_DB_NAME" ]]; then
        save_db_credentials "$DB_NAME" "$DB_PASSWORD" "$SECRET_KEY" "$ADMIN_PASSWORD"
        log_info "Credentials saved for future reconnection"
    fi
}

# -----------------------------------------------------------------------------
# Main Entry Point
# -----------------------------------------------------------------------------
main() {
    # Parse command line arguments
    parse_arguments "$@"

    # Validate requirements (basic tools first)
    check_requirements

    if [[ "$RECONNECT_MODE" == "true" ]]; then
        # Reconnect flow - use existing database
        initialize_reconnect_config
        prompt_reconnect_credentials
        check_postgres_running
        check_superuser_access
        check_port_available "$DEV_PORT"
        validate_reconnect_database
        # Skip: setup_database, run_migrations, create_admin_user, configure_skip_auth
    else
        # Normal flow - create new database
        # Prompt for sudo password upfront (Linux only)
        # This caches credentials before any operations that need sudo
        prompt_sudo_upfront

        # Continue validation
        check_postgres_running
        check_superuser_access
        check_port_available "$DEV_PORT"

        # Initialize configuration
        initialize_config

        # Setup phase
        setup_database
        run_migrations
        create_admin_user
        configure_skip_auth
    fi

    # Set up signal handlers
    trap cleanup EXIT INT TERM

    # Create log file header if logging enabled
    if [[ "$LOG_ENABLED" == "true" ]] && [[ -n "$LOG_FILE" ]]; then
        {
            echo "=== Comradarr Test Dev Server Log ==="
            echo "Started: $(date)"
            echo "Database: $DB_NAME"
            echo "Mode: $(if [[ "$RECONNECT_MODE" == "true" ]]; then echo "Reconnect"; else echo "New"; fi)"
            echo "========================================="
            echo ""
        } > "$LOG_FILE"
    fi

    # Display startup banner
    display_banner

    # Start dev server
    start_dev_server

    # Write state file for stop-dev.sh
    write_state_file

    # Wait for dev server to exit
    wait "$DEV_SERVER_PID" 2>/dev/null || true
}

main "$@"
