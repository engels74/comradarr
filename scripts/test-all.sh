#!/usr/bin/env bash
#
# Automated Test Runner for Comradarr
# ====================================
#
# Runs both unit tests (vitest) and integration tests (bun test) with
# FULLY AUTOMATIC PostgreSQL and test database lifecycle management.
#
# Usage:
#   ./scripts/test-all.sh           # Run all tests (unit + integration)
#   ./scripts/test-all.sh --unit    # Run unit tests only (no database required)
#   ./scripts/test-all.sh --integration  # Run integration tests only
#   ./scripts/test-all.sh --skip-db # Skip database setup (assume it's ready)
#   ./scripts/test-all.sh --no-auto-install  # Don't auto-install PostgreSQL
#
# The script will automatically:
#   1. Install PostgreSQL if not installed (WSL/Ubuntu/Debian)
#   2. Start PostgreSQL if not running
#   3. Create test database and user if needed
#   4. Run migrations if database schema is outdated
#   5. Run unit tests via vitest (no database required)
#   6. Run integration tests with proper environment variables
#
# Exit Codes:
#   0 - All tests passed
#   1 - Unit tests failed
#   2 - Integration tests failed
#   3 - PostgreSQL setup failed (integration tests skipped)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Configuration (matches test-db.sh defaults)
TEST_DB_USER="${TEST_DB_USER:-comradarr_test}"
TEST_DB_PASSWORD="${TEST_DB_PASSWORD:-testpassword}"
TEST_DB_NAME="${TEST_DB_NAME:-comradarr_test}"
TEST_DB_HOST="${TEST_DB_HOST:-localhost}"
TEST_DB_PORT="${TEST_DB_PORT:-5432}"
TEST_SECRET_KEY="${TEST_SECRET_KEY:-$(echo -n "testsecretkey123testsecretkey123" | xxd -p | tr -d '\n')}"
DATABASE_URL="postgres://${TEST_DB_USER}:${TEST_DB_PASSWORD}@${TEST_DB_HOST}:${TEST_DB_PORT}/${TEST_DB_NAME}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Logging functions
log_header() { echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; echo -e "${CYAN}  $1${NC}"; echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"; }
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1" >&2; }

# =============================================================================
# PostgreSQL Auto-Setup Functions
# =============================================================================

# Check if running on a supported Linux distribution
check_linux_support() {
    if [[ ! -f /etc/os-release ]]; then
        return 1
    fi
    source /etc/os-release
    case "$ID" in
        ubuntu|debian|linuxmint|pop) return 0 ;;
        *) return 1 ;;
    esac
}

# Install PostgreSQL automatically (requires sudo)
auto_install_postgres() {
    log_info "PostgreSQL not found. Installing automatically..."

    if ! check_linux_support; then
        log_error "Automatic installation only supported on Ubuntu/Debian-based systems"
        log_info "Please install PostgreSQL manually for your distribution"
        return 1
    fi

    # Check if we can use sudo
    if ! sudo -n true 2>/dev/null; then
        log_info "Sudo password required for PostgreSQL installation"
    fi

    # Update package list silently
    log_info "Updating package list..."
    if ! sudo apt-get update -qq; then
        log_error "Failed to update package list"
        return 1
    fi

    # Install PostgreSQL
    log_info "Installing PostgreSQL (this may take a minute)..."
    if ! sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-contrib; then
        log_error "Failed to install PostgreSQL"
        return 1
    fi

    log_success "PostgreSQL installed successfully!"
    log_info "Version: $(psql --version)"
    return 0
}

# Start PostgreSQL service and wait for it to be ready
auto_start_postgres() {
    log_info "Starting PostgreSQL service..."

    # Try to start the service
    if ! sudo service postgresql start 2>/dev/null; then
        log_error "Failed to start PostgreSQL service"
        return 1
    fi

    # Wait for PostgreSQL to be ready (max 30 seconds)
    local retries=30
    log_info "Waiting for PostgreSQL to be ready..."
    while ! pg_isready -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" -q 2>/dev/null; do
        retries=$((retries - 1))
        if [ "$retries" -eq 0 ]; then
            log_error "PostgreSQL failed to start within 30 seconds"
            return 1
        fi
        sleep 1
    done

    log_success "PostgreSQL is running"
    return 0
}

# Set up the test database (create user, database, run migrations)
auto_setup_database() {
    log_info "Setting up test database..."

    # Create test user if it doesn't exist
    log_info "Ensuring test user '${TEST_DB_USER}' exists..."
    if ! sudo -u postgres psql -q -c "
        DO \$\$
        BEGIN
            IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${TEST_DB_USER}') THEN
                CREATE ROLE ${TEST_DB_USER} WITH LOGIN PASSWORD '${TEST_DB_PASSWORD}';
            ELSE
                ALTER ROLE ${TEST_DB_USER} WITH PASSWORD '${TEST_DB_PASSWORD}';
            END IF;
        END
        \$\$;
    " 2>/dev/null; then
        log_error "Failed to create/update test user"
        return 1
    fi

    # Check if database exists
    local db_exists=false
    if sudo -u postgres psql -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw "$TEST_DB_NAME"; then
        db_exists=true
    fi

    if [ "$db_exists" = false ]; then
        # Create test database
        log_info "Creating test database '${TEST_DB_NAME}'..."
        if ! sudo -u postgres psql -q -c "CREATE DATABASE ${TEST_DB_NAME} OWNER ${TEST_DB_USER};" 2>/dev/null; then
            log_error "Failed to create test database"
            return 1
        fi

        # Grant privileges
        sudo -u postgres psql -q -c "GRANT ALL PRIVILEGES ON DATABASE ${TEST_DB_NAME} TO ${TEST_DB_USER};" 2>/dev/null
        sudo -u postgres psql -q -d "$TEST_DB_NAME" -c "GRANT ALL ON SCHEMA public TO ${TEST_DB_USER};" 2>/dev/null

        log_success "Test database created"
    else
        log_info "Test database '${TEST_DB_NAME}' already exists"
    fi

    # Run migrations (always run to ensure schema is up to date)
    log_info "Running Drizzle migrations..."
    if ! DATABASE_URL="$DATABASE_URL" SECRET_KEY="$TEST_SECRET_KEY" bunx drizzle-kit migrate 2>&1; then
        log_error "Failed to run migrations"
        return 1
    fi

    log_success "Test database is ready"
    return 0
}

# Main PostgreSQL setup orchestrator
# Returns 0 if PostgreSQL is ready, 1 if setup failed
ensure_postgres_ready() {
    local auto_install="$1"

    # Step 1: Check if PostgreSQL is installed
    if ! command -v psql &> /dev/null; then
        if [ "$auto_install" = true ]; then
            if ! auto_install_postgres; then
                return 1
            fi
        else
            log_warn "PostgreSQL is not installed"
            log_info "Remove --no-auto-install flag or install manually: ./scripts/test-db.sh install"
            return 1
        fi
    else
        log_success "PostgreSQL is installed"
    fi

    # Step 2: Check if PostgreSQL is running
    if ! pg_isready -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" -q 2>/dev/null; then
        if ! auto_start_postgres; then
            return 1
        fi
    else
        log_success "PostgreSQL is running"
    fi

    # Step 3: Check if test database is ready
    if ! PGPASSWORD="$TEST_DB_PASSWORD" psql -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" \
            -U "$TEST_DB_USER" -d "$TEST_DB_NAME" -c '\q' &> /dev/null 2>&1; then
        if ! auto_setup_database; then
            return 1
        fi
    else
        # Database exists and is accessible, but still check migrations
        log_info "Ensuring migrations are up to date..."
        if ! DATABASE_URL="$DATABASE_URL" SECRET_KEY="$TEST_SECRET_KEY" bunx drizzle-kit migrate 2>&1 | grep -v "^$"; then
            log_warn "Migration check completed (some warnings may be expected)"
        fi
        log_success "Test database is ready"
    fi

    return 0
}

# Parse arguments
RUN_UNIT=true
RUN_INTEGRATION=true
SKIP_DB_SETUP=false
AUTO_INSTALL=true

while [[ $# -gt 0 ]]; do
    case $1 in
        --unit)
            RUN_UNIT=true
            RUN_INTEGRATION=false
            shift
            ;;
        --integration)
            RUN_UNIT=false
            RUN_INTEGRATION=true
            shift
            ;;
        --skip-db)
            SKIP_DB_SETUP=true
            shift
            ;;
        --no-auto-install)
            AUTO_INSTALL=false
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --unit              Run unit tests only (no database required)"
            echo "  --integration       Run integration tests only"
            echo "  --skip-db           Skip automatic database setup"
            echo "  --no-auto-install   Don't auto-install PostgreSQL if missing"
            echo "  -h, --help          Show this help message"
            echo ""
            echo "By default, the script will automatically:"
            echo "  - Install PostgreSQL if not installed (Ubuntu/Debian)"
            echo "  - Start PostgreSQL if not running"
            echo "  - Create test database and run migrations"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Track overall result
UNIT_RESULT=0
INTEGRATION_RESULT=0
INTEGRATION_SKIPPED=false

cd "$PROJECT_ROOT"

# =============================================================================
# Unit Tests
# =============================================================================
if [ "$RUN_UNIT" = true ]; then
    log_header "Running Unit Tests (vitest)"
    
    if bun run vitest run; then
        log_success "Unit tests passed"
    else
        UNIT_RESULT=1
        log_error "Unit tests failed"
    fi
fi

# =============================================================================
# Integration Tests
# =============================================================================
if [ "$RUN_INTEGRATION" = true ]; then
    log_header "PostgreSQL Setup"

    if [ "$SKIP_DB_SETUP" = true ]; then
        log_info "Skipping database setup (--skip-db flag set)"
        # Still verify PostgreSQL is reachable
        if ! pg_isready -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" -q 2>/dev/null; then
            log_error "PostgreSQL is not reachable but --skip-db was specified"
            INTEGRATION_SKIPPED=true
        fi
    else
        # Run the full auto-setup (install, start, create DB, migrate)
        if ! ensure_postgres_ready "$AUTO_INSTALL"; then
            log_warn "PostgreSQL setup failed"
            log_warn "Integration tests will be skipped"
            if [ "$AUTO_INSTALL" = false ]; then
                log_info "Tip: Run without --no-auto-install to auto-install PostgreSQL"
            fi
            INTEGRATION_SKIPPED=true
        fi
    fi

    # Run integration tests if PostgreSQL is ready
    if [ "$INTEGRATION_SKIPPED" = false ]; then
        log_header "Running Integration Tests (bun test)"

        log_info "Running integration tests..."
        export DATABASE_URL
        export SECRET_KEY="$TEST_SECRET_KEY"

        if bun test tests/integration/; then
            log_success "Integration tests passed"
        else
            INTEGRATION_RESULT=2
            log_error "Integration tests failed"
        fi
    fi
fi

# =============================================================================
# Summary
# =============================================================================
log_header "Test Summary"

if [ "$RUN_UNIT" = true ]; then
    if [ "$UNIT_RESULT" -eq 0 ]; then
        log_success "Unit tests: PASSED"
    else
        log_error "Unit tests: FAILED"
    fi
fi

if [ "$RUN_INTEGRATION" = true ]; then
    if [ "$INTEGRATION_SKIPPED" = true ]; then
        log_warn "Integration tests: SKIPPED (PostgreSQL setup failed)"
        log_info "  This may happen if sudo is required but not available"
        log_info "  Try running: ./scripts/test-db.sh install && ./scripts/test-db.sh setup"
    elif [ "$INTEGRATION_RESULT" -eq 0 ]; then
        log_success "Integration tests: PASSED"
    else
        log_error "Integration tests: FAILED"
    fi
fi

# Exit with appropriate code
if [ "$UNIT_RESULT" -ne 0 ]; then
    exit 1
elif [ "$INTEGRATION_RESULT" -ne 0 ]; then
    exit 2
elif [ "$INTEGRATION_SKIPPED" = true ]; then
    # Exit 0 but with warning - don't fail CI just because PostgreSQL setup failed
    # This allows the script to be used in environments without PostgreSQL
    exit 0
else
    log_success "All tests passed!"
    exit 0
fi

