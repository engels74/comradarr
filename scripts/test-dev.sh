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
PERSIST_MODE=false
DEV_PORT=5173
DB_PORT=5432
DB_HOST=localhost
LOG_ENABLED=true
LOG_FILE=""
CUSTOM_DB_NAME=""
CUSTOM_ADMIN_PASSWORD=""

# Generated values (set during initialization)
DB_NAME=""
DB_USER=""
DB_PASSWORD=""
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
# Validation Functions
# -----------------------------------------------------------------------------

# Prompt for sudo password upfront and cache credentials (Linux only)
# This ensures all subsequent sudo commands work without re-prompting
prompt_sudo_upfront() {
    if [[ "$OS_TYPE" != "linux" ]]; then
        return 0
    fi

    # Check if we already have valid sudo credentials cached
    if sudo -n true 2>/dev/null; then
        return 0
    fi

    echo ""
    log_info "This script requires sudo privileges for PostgreSQL operations."
    log_info "Please enter your password to cache sudo credentials."
    echo ""

    # Prompt for sudo password (interactive)
    if ! sudo -v; then
        log_error "Failed to obtain sudo credentials"
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
    DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}" \
    SECRET_KEY="$SECRET_KEY" \
    bunx drizzle-kit migrate

    log_success "Migrations completed"
}

create_admin_user() {
    log_info "Creating admin user..."

    cd "$PROJECT_ROOT"

    # Create a temporary TypeScript file to hash password and insert user
    local temp_script
    temp_script=$(mktemp /tmp/create-admin-XXXXXX.ts)

    cat > "$temp_script" << 'SCRIPT_EOF'
import { hash } from '@node-rs/argon2';
import { SQL } from 'bun';

const ARGON2_OPTIONS = {
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
    algorithm: 2
} as const;

async function createAdmin() {
    const password = process.env.ADMIN_PASSWORD!;
    const passwordHash = await hash(password, ARGON2_OPTIONS);

    const client = new SQL({
        url: process.env.DATABASE_URL!,
        max: 1,
        idleTimeout: 5
    });

    try {
        // Check if user exists
        const existing = await client`SELECT id FROM users WHERE username = 'admin' LIMIT 1`;
        if (existing.length > 0) {
            console.log('Admin user already exists');
            return;
        }

        // Insert admin user
        await client`
            INSERT INTO users (username, password_hash, display_name, role)
            VALUES ('admin', ${passwordHash}, 'Administrator', 'admin')
        `;
        console.log('Admin user created');
    } finally {
        client.end();
    }
}

createAdmin().catch(err => {
    console.error('Failed to create admin:', err);
    process.exit(1);
});
SCRIPT_EOF

    DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}" \
    SECRET_KEY="$SECRET_KEY" \
    ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    bun run "$temp_script"

    rm -f "$temp_script"
    log_success "Admin user created"
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

    # Handle persist mode
    if [[ "$PERSIST_MODE" == "true" ]]; then
        echo ""
        read -r -p "Keep database and logs? (y/N) " response
        if [[ "${response,,}" == "y" ]]; then
            echo ""
            log_success "Resources preserved!"
            echo ""
            echo -e "${CYAN}${BOLD}=== Preserved Resources ===${NC}"
            echo -e "Database: ${GREEN}postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}${NC}"
            echo -e "Admin Login: ${GREEN}admin / ${ADMIN_PASSWORD}${NC}"
            if [[ -n "$LOG_FILE" ]] && [[ -f "$LOG_FILE" ]]; then
                echo -e "Log File: ${GREEN}${LOG_FILE}${NC}"
            fi
            echo ""
            echo "To reuse this database:"
            echo "  export DATABASE_URL='postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}'"
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

    # Drop database
    if database_exists "$DB_NAME" 2>/dev/null; then
        log_info "Dropping database '${DB_NAME}'..."
        run_psql_superuser "DROP DATABASE ${DB_NAME};" 2>/dev/null || true
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
    if [[ "$PERSIST_MODE" == "true" ]]; then
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
    echo -e "${CYAN}${BOLD}║${NC} Database:    ${GREEN}postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}${NC}"
    echo -e "${CYAN}${BOLD}║${NC} Admin Login: ${GREEN}admin${NC} / ${GREEN}${ADMIN_PASSWORD}${NC}"
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
    export DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
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
    --help, -h              Show this help message

EXAMPLES:
    # Quick ephemeral development session
    ./scripts/test-dev.sh

    # Persistent database for multi-session development
    ./scripts/test-dev.sh --persist

    # Named database for repeatable setup
    ./scripts/test-dev.sh --db-name my_feature_db

    # Custom ports
    ./scripts/test-dev.sh --port 3000 --db-port 5433

    # Fixed admin password for automation
    ./scripts/test-dev.sh --admin-password mysecretpassword

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
}

# -----------------------------------------------------------------------------
# Main Entry Point
# -----------------------------------------------------------------------------
main() {
    # Parse command line arguments
    parse_arguments "$@"

    # Validate requirements (basic tools first)
    check_requirements

    # Prompt for sudo password upfront (Linux only)
    # This caches credentials before any operations that need sudo
    prompt_sudo_upfront

    # Continue validation
    check_postgres_running
    check_superuser_access
    check_port_available "$DEV_PORT"

    # Initialize configuration
    initialize_config

    # Set up signal handlers
    trap cleanup EXIT INT TERM

    # Create log file header if logging enabled
    if [[ "$LOG_ENABLED" == "true" ]] && [[ -n "$LOG_FILE" ]]; then
        {
            echo "=== Comradarr Test Dev Server Log ==="
            echo "Started: $(date)"
            echo "Database: $DB_NAME"
            echo "========================================="
            echo ""
        } > "$LOG_FILE"
    fi

    # Setup phase
    setup_database
    run_migrations
    create_admin_user

    # Display startup banner
    display_banner

    # Start dev server
    start_dev_server

    # Wait for dev server to exit
    wait "$DEV_SERVER_PID" 2>/dev/null || true
}

main "$@"
