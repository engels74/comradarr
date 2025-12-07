#!/usr/bin/env bash
#
# Stop Development Server for Comradarr
# ======================================
#
# Stops the test development server started by test-dev.sh
#
# Usage:
#   ./scripts/stop-dev.sh                    # Stop gracefully, preserve persistent DBs
#   ./scripts/stop-dev.sh --force-cleanup    # Stop and cleanup everything
#   ./scripts/stop-dev.sh --status           # Check server status
#   ./scripts/stop-dev.sh --help             # Show usage
#
# Alternative cleanup flags (all equivalent to --force-cleanup):
#   ./scripts/stop-dev.sh --clean-all
#   ./scripts/stop-dev.sh --purge

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
STATE_FILE="/tmp/comradarr-dev-state.json"
FORCE_CLEANUP=false
SHOW_STATUS_ONLY=false
GRACEFUL_TIMEOUT=10

# Colors (match test-dev.sh)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# -----------------------------------------------------------------------------
# Logging Functions
# -----------------------------------------------------------------------------
log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1" >&2; }

# -----------------------------------------------------------------------------
# OS Detection
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
# State File Functions
# -----------------------------------------------------------------------------

# Read and validate state file
read_state_file() {
    if [[ ! -f "$STATE_FILE" ]]; then
        return 1
    fi

    # Validate JSON if jq is available
    if command -v jq &> /dev/null; then
        if ! jq empty "$STATE_FILE" 2>/dev/null; then
            log_error "State file is corrupted"
            return 1
        fi
    fi

    return 0
}

# Extract field from state file (jq with grep/sed fallback)
get_state_field() {
    local field="$1"

    if command -v jq &> /dev/null; then
        jq -r ".$field // empty" "$STATE_FILE" 2>/dev/null || echo ""
    else
        # Fallback: grep + sed parsing for simple JSON
        grep "\"$field\"" "$STATE_FILE" 2>/dev/null | \
            sed 's/.*: *"\{0,1\}\([^",]*\)"\{0,1\}.*/\1/' | \
            head -1 || echo ""
    fi
}

# -----------------------------------------------------------------------------
# Process Functions
# -----------------------------------------------------------------------------

# Discover dev server process if state file is missing
discover_dev_server() {
    local pids

    # Look for vite dev processes in our project
    pids=$(pgrep -f "vite.*dev" 2>/dev/null || true)

    if [[ -z "$pids" ]]; then
        # Also try looking for bun run dev
        pids=$(pgrep -f "bun.*run.*dev" 2>/dev/null || true)
    fi

    if [[ -z "$pids" ]]; then
        return 1
    fi

    # If multiple, warn (to stderr so it doesn't mix with pid output)
    local pid_count
    pid_count=$(echo "$pids" | wc -l | tr -d ' ')
    if [[ $pid_count -gt 1 ]]; then
        log_warn "Found multiple dev server processes" >&2
    fi

    echo "$pids" | head -1
    return 0
}

# Stop a process gracefully with timeout
stop_process() {
    local pid="$1"
    local name="${2:-process}"

    # Check if running
    if ! kill -0 "$pid" 2>/dev/null; then
        log_info "$name (PID: $pid) is not running"
        return 0
    fi

    # Graceful shutdown (SIGTERM)
    log_info "Stopping $name (PID: $pid) with SIGTERM..."
    kill -TERM "$pid" 2>/dev/null || true

    # Wait for graceful exit
    local elapsed=0
    while kill -0 "$pid" 2>/dev/null && [[ $elapsed -lt $GRACEFUL_TIMEOUT ]]; do
        sleep 1
        elapsed=$((elapsed + 1))
        if [[ $((elapsed % 3)) -eq 0 ]]; then
            log_info "Waiting for $name to exit... (${elapsed}s)"
        fi
    done

    # Check if exited
    if ! kill -0 "$pid" 2>/dev/null; then
        log_success "$name stopped gracefully"
        return 0
    fi

    # Force kill (SIGKILL)
    log_warn "$name did not exit within ${GRACEFUL_TIMEOUT}s, sending SIGKILL..."
    kill -9 "$pid" 2>/dev/null || true
    sleep 1

    if ! kill -0 "$pid" 2>/dev/null; then
        log_success "$name forcefully stopped"
        return 0
    else
        log_error "Failed to stop $name"
        return 1
    fi
}

# -----------------------------------------------------------------------------
# Database Functions (adapted from test-dev.sh)
# -----------------------------------------------------------------------------

# Execute SQL as superuser (handles platform differences)
run_psql_superuser() {
    local sql="$1"
    local db="${2:-postgres}"
    local db_host="${3:-localhost}"
    local db_port="${4:-5432}"

    if [[ "$OS_TYPE" == "macos" ]]; then
        psql -h "$db_host" -p "$db_port" -d "$db" -q -c "$sql" 2>/dev/null
    else
        sudo -n -u postgres psql -p "$db_port" ${db:+-d "$db"} -q -c "$sql" 2>/dev/null
    fi
}

# List databases (with timeout to prevent hangs)
list_databases() {
    local db_host="${1:-localhost}"
    local db_port="${2:-5432}"

    if [[ "$OS_TYPE" == "macos" ]]; then
        timeout 5 psql -h "$db_host" -p "$db_port" -d postgres -lqt 2>/dev/null || true
    else
        timeout 5 sudo -n -u postgres psql -p "$db_port" -lqt 2>/dev/null || true
    fi
}

# Check if database exists
database_exists() {
    local db_name="$1"
    local db_host="${2:-localhost}"
    local db_port="${3:-5432}"

    list_databases "$db_host" "$db_port" | cut -d \| -f 1 | grep -qw "$db_name"
}

# Cleanup database and user
cleanup_database() {
    local db_name="$1"
    local db_user="$2"
    local db_host="${3:-localhost}"
    local db_port="${4:-5432}"
    local persist_mode="${5:-false}"

    # Skip if persistent and not forcing cleanup
    if [[ "$persist_mode" == "true" ]] && [[ "$FORCE_CLEANUP" != "true" ]]; then
        echo ""
        log_info "Database '${db_name}' preserved (persistent mode)"
        log_info "Use --force-cleanup to remove"
        return 0
    fi

    log_info "Cleaning up database '${db_name}'..."

    # Drop database
    if database_exists "$db_name" "$db_host" "$db_port" 2>/dev/null; then
        if run_psql_superuser "DROP DATABASE ${db_name};" "postgres" "$db_host" "$db_port"; then
            log_success "Database '${db_name}' dropped"
        else
            log_warn "Failed to drop database '${db_name}'"
        fi
    else
        log_info "Database '${db_name}' does not exist (already cleaned up)"
    fi

    # Drop user
    if [[ -n "$db_user" ]]; then
        if run_psql_superuser "DROP ROLE IF EXISTS ${db_user};" "postgres" "$db_host" "$db_port"; then
            log_success "User '${db_user}' dropped"
        else
            log_warn "Failed to drop user '${db_user}'"
        fi
    fi
}

# -----------------------------------------------------------------------------
# Verification Functions
# -----------------------------------------------------------------------------

# Check for orphaned resources
check_orphaned_resources() {
    log_info "Checking for orphaned resources..."

    local found_issues=false

    # Check for orphaned dev processes
    local orphan_pids
    orphan_pids=$(pgrep -f "vite.*dev" 2>/dev/null || true)
    if [[ -n "$orphan_pids" ]]; then
        log_warn "Found dev server process(es) still running:"
        pgrep -af "vite.*dev" 2>/dev/null | head -3 || true
        found_issues=true
    fi

    # Check for port in use
    if lsof -Pi :5173 -sTCP:LISTEN -t &>/dev/null 2>&1; then
        log_warn "Port 5173 is still in use"
        found_issues=true
    fi

    # Check for old log files
    local old_logs
    old_logs=$(find /tmp -maxdepth 1 -name "comradarr-test-dev-*.log" -type f 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$old_logs" -gt 0 ]]; then
        log_info "Found $old_logs log file(s) in /tmp"
        find /tmp -maxdepth 1 -name "comradarr-test-dev-*.log" -type f 2>/dev/null | head -3 || true
    fi

    # Check for comradarr dev databases (optional check, don't fail if it doesn't work)
    local dev_dbs="0"
    if dev_dbs=$(list_databases 2>/dev/null | cut -d \| -f 1 | { grep "comradarr_dev_" || true; } | wc -l 2>/dev/null); then
        dev_dbs="${dev_dbs// /}"  # Remove spaces
        dev_dbs="${dev_dbs:-0}"   # Default to 0 if empty
        if [[ "$dev_dbs" =~ ^[0-9]+$ ]] && [[ "$dev_dbs" -gt 0 ]]; then
            log_info "Found $dev_dbs comradarr_dev_* database(s)"
        fi
    fi

    if [[ "$found_issues" == "false" ]]; then
        log_success "No orphaned resources found"
    fi

    return 0
}

# -----------------------------------------------------------------------------
# Status Command
# -----------------------------------------------------------------------------

show_status() {
    echo ""
    echo -e "${CYAN}${BOLD}Development Server Status${NC}"
    echo -e "${CYAN}=========================${NC}"
    echo ""

    # Check state file
    if [[ -f "$STATE_FILE" ]]; then
        log_success "State file exists: $STATE_FILE"

        if read_state_file; then
            local pid port db_name persist log_file timestamp

            pid=$(get_state_field "pid")
            port=$(get_state_field "port")
            db_name=$(get_state_field "dbName")
            persist=$(get_state_field "persistMode")
            log_file=$(get_state_field "logFile")
            timestamp=$(get_state_field "timestamp")

            echo ""
            echo "  PID:        $pid"
            echo "  Port:       $port"
            echo "  Database:   $db_name"
            echo "  Persist:    $persist"
            echo "  Started:    $timestamp"
            if [[ -n "$log_file" ]]; then
                echo "  Log:        $log_file"
            fi
            echo ""

            # Check if process is running
            if kill -0 "$pid" 2>/dev/null; then
                log_success "Dev server is RUNNING (PID: $pid)"
            else
                log_warn "Dev server is NOT running (stale state file)"
                echo ""
                echo "  The state file exists but the process is dead."
                echo "  Run './scripts/stop-dev.sh' to clean up."
            fi
        else
            log_error "State file is corrupted"
        fi
    else
        log_info "No state file found at $STATE_FILE"
        echo ""

        # Try process discovery
        local discovered_pid
        if discovered_pid=$(discover_dev_server 2>/dev/null); then
            log_warn "Found dev server without state file (PID: $discovered_pid)"
            echo ""
            echo "  A dev server appears to be running but has no state file."
            echo "  This may happen if test-dev.sh was interrupted before"
            echo "  writing state, or if the state file was manually deleted."
            echo ""
            echo "  Run './scripts/stop-dev.sh' to stop it (limited cleanup)."
        else
            log_info "No dev server processes found"
        fi
    fi

    echo ""
    check_orphaned_resources
    echo ""
}

# -----------------------------------------------------------------------------
# Help Function
# -----------------------------------------------------------------------------

show_help() {
    cat << 'EOF'
Stop Development Server for Comradarr
======================================

Stops the test development server started by test-dev.sh

USAGE:
    ./scripts/stop-dev.sh [OPTIONS]

OPTIONS:
    --force-cleanup         Force cleanup of all resources, including persistent
                            databases and log files
    --clean-all             Alias for --force-cleanup
    --purge                 Alias for --force-cleanup
    --status                Check if server is running (don't stop)
    --help, -h              Show this help message

BEHAVIOR:
    Default Mode:
        - Stops dev server gracefully (SIGTERM, then SIGKILL if needed)
        - Preserves persistent databases (started with --persist or --db-name)
        - Removes ephemeral databases
        - Cleans up log files (unless persistent)
        - Removes state file

    Force Cleanup (--force-cleanup):
        - Stops dev server
        - Removes ALL resources, including persistent databases and logs
        - Complete cleanup regardless of persist mode

    Status (--status):
        - Shows server status without stopping
        - Displays database, port, and process information
        - Checks for orphaned resources

EXAMPLES:
    # Stop server, preserve persistent DBs
    ./scripts/stop-dev.sh

    # Stop and clean everything
    ./scripts/stop-dev.sh --force-cleanup

    # Check status
    ./scripts/stop-dev.sh --status

FALLBACK:
    If no state file exists (e.g., test-dev.sh was interrupted), the script
    attempts to discover the dev server process automatically. In this mode,
    database cleanup may be incomplete since the database name is unknown.

STATE FILE:
    /tmp/comradarr-dev-state.json

    This file is created by test-dev.sh and contains runtime information
    needed for proper cleanup (PID, database name, persist mode, etc.).

EOF
}

# -----------------------------------------------------------------------------
# Argument Parsing
# -----------------------------------------------------------------------------

parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --force-cleanup|--clean-all|--purge)
                FORCE_CLEANUP=true
                shift
                ;;
            --status)
                SHOW_STATUS_ONLY=true
                shift
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                echo "Run './scripts/stop-dev.sh --help' for usage."
                exit 1
                ;;
        esac
    done
}

# -----------------------------------------------------------------------------
# Main Logic
# -----------------------------------------------------------------------------

main() {
    parse_arguments "$@"

    # Status-only mode
    if [[ "$SHOW_STATUS_ONLY" == "true" ]]; then
        show_status
        exit 0
    fi

    echo ""
    log_info "Stopping Comradarr development server..."
    echo ""

    # Check for state file
    if ! read_state_file; then
        log_warn "No state file found at $STATE_FILE"
        log_info "Attempting process discovery..."
        echo ""

        local discovered_pid
        if discovered_pid=$(discover_dev_server); then
            log_success "Found dev server (PID: $discovered_pid)"

            if stop_process "$discovered_pid" "dev server"; then
                echo ""
                log_success "Dev server stopped"
                echo ""
                log_warn "Database cleanup skipped (no state file)"
                log_info "If a database was created, you may need to clean it up manually:"
                echo "  psql -c \"SELECT datname FROM pg_database WHERE datname LIKE 'comradarr_dev_%';\""
                echo ""
                check_orphaned_resources
                exit 0
            else
                log_error "Failed to stop dev server"
                exit 1
            fi
        else
            log_info "No running dev server found"
            echo ""
            log_info "The server may have already been stopped."
            log_info "Use './scripts/stop-dev.sh --status' to check for orphaned resources."
            exit 0
        fi
    fi

    # Read state
    local pid sudo_pid db_name db_user db_host db_port log_file persist_mode

    pid=$(get_state_field "pid")
    sudo_pid=$(get_state_field "sudoRefreshPid")
    db_name=$(get_state_field "dbName")
    db_user=$(get_state_field "dbUser")
    db_host=$(get_state_field "dbHost")
    db_port=$(get_state_field "dbPort")
    log_file=$(get_state_field "logFile")
    persist_mode=$(get_state_field "persistMode")

    # Default values if not found
    db_host="${db_host:-localhost}"
    db_port="${db_port:-5432}"

    # Stop dev server
    if [[ -n "$pid" ]]; then
        stop_process "$pid" "dev server"
    else
        log_warn "No PID found in state file"
    fi

    # Stop sudo refresh (Linux only)
    if [[ -n "$sudo_pid" ]] && [[ "$sudo_pid" != "0" ]] && [[ "$sudo_pid" != "null" ]]; then
        stop_process "$sudo_pid" "sudo refresh" 2>/dev/null || true
    fi

    echo ""

    # Handle database cleanup
    if [[ -n "$db_name" ]]; then
        cleanup_database "$db_name" "$db_user" "$db_host" "$db_port" "$persist_mode"
    fi

    # Handle log file cleanup
    if [[ -n "$log_file" ]] && [[ -f "$log_file" ]]; then
        if [[ "$persist_mode" == "true" ]] && [[ "$FORCE_CLEANUP" != "true" ]]; then
            log_info "Log file preserved: $log_file"
        else
            log_info "Removing log file..."
            rm -f "$log_file"
            log_success "Log file removed"
        fi
    fi

    # Remove state file
    rm -f "$STATE_FILE"

    echo ""
    log_success "Development server stopped"
    echo ""

    # Final verification
    check_orphaned_resources
    echo ""
}

main "$@"
