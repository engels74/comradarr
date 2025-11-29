#!/usr/bin/env bash
#
# Automated Test Runner for Comradarr
# ====================================
#
# Runs both unit tests (vitest) and integration tests (bun test) with
# automatic test database lifecycle management.
#
# Usage:
#   ./scripts/test-all.sh           # Run all tests (unit + integration)
#   ./scripts/test-all.sh --unit    # Run unit tests only (no database required)
#   ./scripts/test-all.sh --integration  # Run integration tests only
#   ./scripts/test-all.sh --skip-db # Skip database setup (assume it's ready)
#
# The script will:
#   1. Run unit tests via vitest (no database required)
#   2. Check PostgreSQL availability for integration tests
#   3. Ensure test database exists (create/migrate if needed)
#   4. Run integration tests with proper environment variables
#
# Exit Codes:
#   0 - All tests passed
#   1 - Unit tests failed
#   2 - Integration tests failed
#   3 - PostgreSQL not available (integration tests skipped)

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

# Parse arguments
RUN_UNIT=true
RUN_INTEGRATION=true
SKIP_DB_SETUP=false

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
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --unit         Run unit tests only (no database required)"
            echo "  --integration  Run integration tests only"
            echo "  --skip-db      Skip automatic database setup"
            echo "  -h, --help     Show this help message"
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
    log_header "Running Integration Tests (bun test)"
    
    # Check if PostgreSQL is installed
    if ! command -v psql &> /dev/null; then
        log_warn "PostgreSQL is not installed"
        log_warn "Integration tests will be skipped"
        log_info "To install PostgreSQL, run: ./scripts/test-db.sh install"
        INTEGRATION_SKIPPED=true
    # Check if PostgreSQL is running
    elif ! pg_isready -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" &> /dev/null; then
        log_warn "PostgreSQL is not running on ${TEST_DB_HOST}:${TEST_DB_PORT}"
        log_warn "Integration tests will be skipped"
        log_info "To start PostgreSQL, run: ./scripts/test-db.sh start"
        INTEGRATION_SKIPPED=true
    else
        # PostgreSQL is available, ensure database is set up
        if [ "$SKIP_DB_SETUP" = false ]; then
            log_info "Checking test database..."
            
            # Check if test database exists and is accessible
            if ! PGPASSWORD="$TEST_DB_PASSWORD" psql -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" \
                    -U "$TEST_DB_USER" -d "$TEST_DB_NAME" -c '\q' &> /dev/null 2>&1; then
                log_info "Test database not ready, setting up..."
                "$SCRIPT_DIR/test-db.sh" setup
            else
                log_success "Test database is ready"
            fi
        fi
        
        # Run integration tests with environment variables
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
        log_warn "Integration tests: SKIPPED (PostgreSQL not available)"
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
    # Exit 0 but with warning - don't fail CI just because PostgreSQL isn't available
    exit 0
else
    log_success "All tests passed!"
    exit 0
fi

