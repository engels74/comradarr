#!/usr/bin/env bash
#
# Test Database Setup Script for Comradarr
# =========================================
#
# A development-focused PostgreSQL setup script for running integration tests
# on WSL (Windows Subsystem for Linux) and macOS without Docker.
#
# Supported Platforms:
#   - Ubuntu/Debian (including WSL)
#   - macOS (Intel and Apple Silicon via Homebrew)
#
# Usage:
#   ./scripts/test-db.sh setup      # Create test database and run migrations
#   ./scripts/test-db.sh teardown   # Drop test database
#   ./scripts/test-db.sh reset      # Drop and recreate test database
#   ./scripts/test-db.sh status     # Check PostgreSQL status and test DB
#   ./scripts/test-db.sh env        # Print environment variables for tests
#   ./scripts/test-db.sh install    # Install PostgreSQL (apt or Homebrew)
#   ./scripts/test-db.sh start      # Start PostgreSQL service
#   ./scripts/test-db.sh stop       # Stop PostgreSQL service
#
# Prerequisites:
#   - PostgreSQL installed (run: ./scripts/test-db.sh install)
#   - Bun installed for running migrations
#   - macOS: Homebrew installed (https://brew.sh)
#
# Environment:
#   TEST_DB_USER     - PostgreSQL user (default: comradarr_test)
#   TEST_DB_PASSWORD - PostgreSQL password (default: testpassword)
#   TEST_DB_NAME     - Database name (default: comradarr_test)
#   TEST_DB_HOST     - Database host (default: localhost)
#   TEST_DB_PORT     - Database port (default: 5432)

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration (can be overridden via environment variables)
# -----------------------------------------------------------------------------
TEST_DB_USER="${TEST_DB_USER:-comradarr_test}"
TEST_DB_PASSWORD="${TEST_DB_PASSWORD:-testpassword}"
TEST_DB_NAME="${TEST_DB_NAME:-comradarr_test}"
TEST_DB_HOST="${TEST_DB_HOST:-localhost}"
TEST_DB_PORT="${TEST_DB_PORT:-5432}"

# Generate test secret key (64 hex chars = 256 bits for AES-256-GCM)
TEST_SECRET_KEY="${TEST_SECRET_KEY:-$(echo -n "testsecretkey123testsecretkey123" | xxd -p | tr -d '\n')}"

# Connection string for tests
DATABASE_URL="postgres://${TEST_DB_USER}:${TEST_DB_PASSWORD}@${TEST_DB_HOST}:${TEST_DB_PORT}/${TEST_DB_NAME}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# -----------------------------------------------------------------------------
# OS Detection
# -----------------------------------------------------------------------------

# Detect operating system
detect_os() {
    case "$(uname -s)" in
        Darwin)
            echo "macos"
            ;;
        Linux)
            echo "linux"
            ;;
        *)
            echo "unsupported"
            ;;
    esac
}

OS_TYPE="$(detect_os)"

# Detect Linux distribution (if on Linux)
detect_linux_distro() {
    if [[ "$OS_TYPE" != "linux" ]]; then
        echo "none"
        return
    fi
    if [[ -f /etc/os-release ]]; then
        # shellcheck source=/dev/null
        source /etc/os-release
        case "$ID" in
            ubuntu|debian|linuxmint|pop) echo "debian" ;;
            *) echo "unknown" ;;
        esac
    else
        echo "unknown"
    fi
}

LINUX_DISTRO="$(detect_linux_distro)"

# Detect Homebrew PostgreSQL version (macOS)
# Returns the installed postgresql@XX formula or empty string
detect_brew_postgres() {
    if [[ "$OS_TYPE" != "macos" ]]; then
        echo ""
        return
    fi
    # Check for versioned PostgreSQL formulas (prefer newer versions)
    for ver in 17 16 15 14; do
        if brew list "postgresql@${ver}" &>/dev/null; then
            echo "postgresql@${ver}"
            return
        fi
    done
    # Check for unversioned postgresql formula
    if brew list postgresql &>/dev/null; then
        echo "postgresql"
        return
    fi
    echo ""
}

# -----------------------------------------------------------------------------
# Helper Functions
# -----------------------------------------------------------------------------
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }

check_postgres_installed() {
    if ! command -v psql &> /dev/null; then
        log_error "PostgreSQL is not installed. Run: ./scripts/test-db.sh install"
        exit 1
    fi
}

check_postgres_running() {
    if ! pg_isready -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" &> /dev/null; then
        log_error "PostgreSQL is not running. Run: ./scripts/test-db.sh start"
        exit 1
    fi
}

# Check if we can connect as postgres superuser
check_superuser_access() {
    if [[ "$OS_TYPE" == "macos" ]]; then
        # On macOS with Homebrew, the current user typically has superuser access
        if ! psql -d postgres -c '\q' &> /dev/null; then
            log_error "Cannot connect to PostgreSQL. Check PostgreSQL installation."
            exit 1
        fi
    else
        if ! sudo -u postgres psql -c '\q' &> /dev/null; then
            log_error "Cannot connect as postgres superuser. Check PostgreSQL installation."
            exit 1
        fi
    fi
}

# Execute SQL as superuser (handles platform differences)
run_psql_superuser() {
    local sql="$1"
    local db="${2:-postgres}"

    if [[ "$OS_TYPE" == "macos" ]]; then
        psql -d "$db" -c "$sql"
    else
        sudo -u postgres psql ${db:+-d "$db"} -c "$sql"
    fi
}

# Execute SQL file as superuser
run_psql_superuser_quiet() {
    local sql="$1"
    local db="${2:-postgres}"

    if [[ "$OS_TYPE" == "macos" ]]; then
        psql -d "$db" -q -c "$sql" 2>/dev/null
    else
        sudo -u postgres psql ${db:+-d "$db"} -q -c "$sql" 2>/dev/null
    fi
}

# List databases (platform-aware)
list_databases() {
    if [[ "$OS_TYPE" == "macos" ]]; then
        psql -d postgres -lqt 2>/dev/null
    else
        sudo -u postgres psql -lqt 2>/dev/null
    fi
}

# -----------------------------------------------------------------------------
# Commands
# -----------------------------------------------------------------------------

cmd_install() {
    case "$OS_TYPE" in
        macos)
            cmd_install_macos
            ;;
        linux)
            if [[ "$LINUX_DISTRO" == "debian" ]]; then
                cmd_install_linux
            else
                log_error "Unsupported Linux distribution. Only Ubuntu/Debian-based systems are supported."
                log_info "Please install PostgreSQL manually for your distribution."
                exit 1
            fi
            ;;
        *)
            log_error "Unsupported operating system: $(uname -s)"
            log_info "Supported platforms: macOS, Ubuntu/Debian Linux"
            exit 1
            ;;
    esac
}

cmd_install_macos() {
    log_info "Installing PostgreSQL on macOS via Homebrew..."

    # Check if Homebrew is installed
    if ! command -v brew &> /dev/null; then
        log_error "Homebrew is not installed. Please install it first:"
        log_info "  /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
        exit 1
    fi

    # Check if PostgreSQL is already installed
    local existing_pg
    existing_pg="$(detect_brew_postgres)"
    if [[ -n "$existing_pg" ]]; then
        log_info "PostgreSQL is already installed: $existing_pg"
        log_info "Version: $(psql --version)"
        return 0
    fi

    # Install PostgreSQL 16 (current LTS-like stable version)
    log_info "Installing PostgreSQL 16 via Homebrew..."
    if ! brew install postgresql@16; then
        log_error "Failed to install PostgreSQL"
        exit 1
    fi

    # Link PostgreSQL binaries to PATH
    log_info "Adding PostgreSQL to PATH..."
    brew link postgresql@16 --force 2>/dev/null || true

    # Start PostgreSQL service
    log_info "Starting PostgreSQL service..."
    brew services start postgresql@16

    # Wait for PostgreSQL to be ready
    local retries=30
    while ! pg_isready -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" &> /dev/null; do
        retries=$((retries - 1))
        if [ "$retries" -eq 0 ]; then
            log_error "PostgreSQL failed to start within 30 seconds"
            exit 1
        fi
        sleep 1
    done

    log_success "PostgreSQL installed and started successfully!"
    log_info "Version: $(psql --version)"
    log_info ""
    log_info "PostgreSQL will start automatically on login via brew services."
    log_info "Data directory: $(brew --prefix)/var/postgresql@16"
}

cmd_install_linux() {
    log_info "Installing PostgreSQL on Ubuntu/Debian..."

    # Update package list
    sudo apt-get update

    # Install PostgreSQL
    sudo apt-get install -y postgresql postgresql-contrib

    # Start PostgreSQL service
    sudo service postgresql start

    # Enable PostgreSQL to start on boot (for systemd-based WSL2)
    if command -v systemctl &> /dev/null && systemctl is-system-running &> /dev/null 2>&1; then
        sudo systemctl enable postgresql
        log_info "PostgreSQL enabled to start on boot (systemd)"
    else
        log_warn "WSL1 or non-systemd WSL2 detected. PostgreSQL won't auto-start."
        log_warn "Add 'sudo service postgresql start' to your shell profile."
    fi

    log_success "PostgreSQL installed successfully!"
    log_info "Version: $(psql --version)"
}

cmd_start() {
    log_info "Starting PostgreSQL service..."

    if [[ "$OS_TYPE" == "macos" ]]; then
        local pg_formula
        pg_formula="$(detect_brew_postgres)"
        if [[ -z "$pg_formula" ]]; then
            log_error "PostgreSQL is not installed via Homebrew. Run: ./scripts/test-db.sh install"
            exit 1
        fi
        brew services start "$pg_formula"
    else
        sudo service postgresql start
    fi

    # Wait for PostgreSQL to be ready
    local retries=30
    while ! pg_isready -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" &> /dev/null; do
        retries=$((retries - 1))
        if [ "$retries" -eq 0 ]; then
            log_error "PostgreSQL failed to start within 30 seconds"
            exit 1
        fi
        sleep 1
    done

    log_success "PostgreSQL is running"
}

cmd_stop() {
    log_info "Stopping PostgreSQL service..."

    if [[ "$OS_TYPE" == "macos" ]]; then
        local pg_formula
        pg_formula="$(detect_brew_postgres)"
        if [[ -z "$pg_formula" ]]; then
            log_error "PostgreSQL is not installed via Homebrew"
            exit 1
        fi
        brew services stop "$pg_formula"
    else
        sudo service postgresql stop
    fi

    log_success "PostgreSQL stopped"
}

cmd_status() {
    log_info "Checking PostgreSQL status..."
    log_info "Platform: ${OS_TYPE}$([ "$OS_TYPE" = "linux" ] && echo " ($LINUX_DISTRO)")"

    # Check if installed
    if ! command -v psql &> /dev/null; then
        log_warn "PostgreSQL is NOT installed"
        echo "  Run: ./scripts/test-db.sh install"
        return
    fi
    log_success "PostgreSQL is installed: $(psql --version)"

    # Show Homebrew formula on macOS
    if [[ "$OS_TYPE" == "macos" ]]; then
        local pg_formula
        pg_formula="$(detect_brew_postgres)"
        if [[ -n "$pg_formula" ]]; then
            log_info "Homebrew formula: $pg_formula"
        fi
    fi

    # Check if running
    if pg_isready -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" &> /dev/null; then
        log_success "PostgreSQL is running on ${TEST_DB_HOST}:${TEST_DB_PORT}"
    else
        log_warn "PostgreSQL is NOT running"
        echo "  Run: ./scripts/test-db.sh start"
        return
    fi

    # Check if test database exists
    if list_databases | cut -d \| -f 1 | grep -qw "$TEST_DB_NAME"; then
        log_success "Test database '${TEST_DB_NAME}' exists"

        # Check if test user can connect
        if PGPASSWORD="$TEST_DB_PASSWORD" psql -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" -U "$TEST_DB_USER" -d "$TEST_DB_NAME" -c '\q' &> /dev/null; then
            log_success "Test user '${TEST_DB_USER}' can connect"
        else
            log_warn "Test user '${TEST_DB_USER}' cannot connect"
        fi
    else
        log_warn "Test database '${TEST_DB_NAME}' does NOT exist"
        echo "  Run: ./scripts/test-db.sh setup"
    fi
}

cmd_setup() {
    log_info "Setting up test database..."

    check_postgres_installed
    check_postgres_running

    # Create test user if it doesn't exist
    log_info "Creating test user '${TEST_DB_USER}'..."
    run_psql_superuser "
        DO \$\$
        BEGIN
            IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${TEST_DB_USER}') THEN
                CREATE ROLE ${TEST_DB_USER} WITH LOGIN PASSWORD '${TEST_DB_PASSWORD}';
            ELSE
                ALTER ROLE ${TEST_DB_USER} WITH PASSWORD '${TEST_DB_PASSWORD}';
            END IF;
        END
        \$\$;
    "

    # Drop existing test database if it exists
    if list_databases | cut -d \| -f 1 | grep -qw "$TEST_DB_NAME"; then
        log_info "Dropping existing test database..."
        run_psql_superuser "DROP DATABASE ${TEST_DB_NAME};"
    fi

    # Create test database
    log_info "Creating test database '${TEST_DB_NAME}'..."
    run_psql_superuser "CREATE DATABASE ${TEST_DB_NAME} OWNER ${TEST_DB_USER};"

    # Grant all privileges
    run_psql_superuser "GRANT ALL PRIVILEGES ON DATABASE ${TEST_DB_NAME} TO ${TEST_DB_USER};"

    # Grant schema privileges (PostgreSQL 15+ requires explicit schema grants)
    run_psql_superuser "GRANT ALL ON SCHEMA public TO ${TEST_DB_USER};" "$TEST_DB_NAME"

    log_success "Test database created successfully!"

    # Run migrations
    log_info "Running Drizzle migrations..."
    DATABASE_URL="$DATABASE_URL" SECRET_KEY="$TEST_SECRET_KEY" bunx drizzle-kit migrate

    log_success "Test database setup complete!"
    log_info ""
    log_info "To run integration tests, use:"
    echo "  DATABASE_URL='$DATABASE_URL' SECRET_KEY='$TEST_SECRET_KEY' bun test tests/integration/"
    log_info ""
    log_info "Or source the environment first:"
    echo "  eval \"\$(./scripts/test-db.sh env)\""
    echo "  bun test tests/integration/"
}

cmd_teardown() {
    log_info "Tearing down test database..."

    check_postgres_installed
    check_postgres_running

    # Drop test database
    if list_databases | cut -d \| -f 1 | grep -qw "$TEST_DB_NAME"; then
        log_info "Dropping database '${TEST_DB_NAME}'..."
        run_psql_superuser "DROP DATABASE ${TEST_DB_NAME};"
        log_success "Test database dropped"
    else
        log_warn "Test database '${TEST_DB_NAME}' does not exist"
    fi

    # Optionally drop test user (commented out to preserve for future use)
    # log_info "Dropping user '${TEST_DB_USER}'..."
    # run_psql_superuser "DROP ROLE IF EXISTS ${TEST_DB_USER};"
}

cmd_reset() {
    log_info "Resetting test database..."
    cmd_teardown
    cmd_setup
}

cmd_env() {
    # Output environment variables that can be eval'd
    echo "export DATABASE_URL='${DATABASE_URL}'"
    echo "export SECRET_KEY='${TEST_SECRET_KEY}'"
    echo "export TEST_DB_USER='${TEST_DB_USER}'"
    echo "export TEST_DB_PASSWORD='${TEST_DB_PASSWORD}'"
    echo "export TEST_DB_NAME='${TEST_DB_NAME}'"
    echo "export TEST_DB_HOST='${TEST_DB_HOST}'"
    echo "export TEST_DB_PORT='${TEST_DB_PORT}'"
}

cmd_help() {
    cat << 'EOF'
Test Database Setup Script for Comradarr
=========================================

A development-focused PostgreSQL setup script for running integration tests
without Docker.

SUPPORTED PLATFORMS:
    - macOS (Intel and Apple Silicon) via Homebrew
    - Ubuntu/Debian Linux (including WSL)

USAGE:
    ./scripts/test-db.sh <command>

COMMANDS:
    install     Install PostgreSQL (via apt on Linux, Homebrew on macOS)
    start       Start PostgreSQL service
    stop        Stop PostgreSQL service
    status      Check PostgreSQL status and test database
    setup       Create test database and run migrations
    teardown    Drop test database
    reset       Drop and recreate test database (teardown + setup)
    env         Print environment variables for tests (eval-friendly)
    help        Show this help message

EXAMPLES:
    # First-time setup on a fresh installation:
    ./scripts/test-db.sh install
    ./scripts/test-db.sh setup

    # Run integration tests:
    eval "$(./scripts/test-db.sh env)"
    bun test tests/integration/

    # Or in one command:
    DATABASE_URL='postgres://comradarr_test:testpassword@localhost:5432/comradarr_test' \
    SECRET_KEY='74657374736563726574....' \
    bun test tests/integration/

    # Reset database between test runs:
    ./scripts/test-db.sh reset

    # Clean up when done:
    ./scripts/test-db.sh teardown
    ./scripts/test-db.sh stop

PLATFORM NOTES:
    macOS:
      - Requires Homebrew (https://brew.sh)
      - Installs postgresql@16 via brew
      - Uses 'brew services' for service management
      - PostgreSQL runs as current user (no sudo required)

    Linux (Ubuntu/Debian/WSL):
      - Uses apt for installation
      - Uses 'sudo service' for service management
      - PostgreSQL runs as 'postgres' system user

ENVIRONMENT VARIABLES:
    TEST_DB_USER      PostgreSQL user (default: comradarr_test)
    TEST_DB_PASSWORD  PostgreSQL password (default: testpassword)
    TEST_DB_NAME      Database name (default: comradarr_test)
    TEST_DB_HOST      Database host (default: localhost)
    TEST_DB_PORT      Database port (default: 5432)
    TEST_SECRET_KEY   Secret key for encryption (auto-generated if not set)

EOF
}

# -----------------------------------------------------------------------------
# Main Entry Point
# -----------------------------------------------------------------------------

main() {
    local command="${1:-help}"

    case "$command" in
        install)    cmd_install ;;
        start)      cmd_start ;;
        stop)       cmd_stop ;;
        status)     cmd_status ;;
        setup)      cmd_setup ;;
        teardown)   cmd_teardown ;;
        reset)      cmd_reset ;;
        env)        cmd_env ;;
        help|--help|-h) cmd_help ;;
        *)
            log_error "Unknown command: $command"
            echo "Run './scripts/test-db.sh help' for usage."
            exit 1
            ;;
    esac
}

main "$@"

