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
PERSISTENT_DBS_FILE="$SCRIPT_DIR/.comradarr-dev-dbs.json"
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

# Kill process and all its descendants (depth-first)
kill_process_tree() {
    local pid="$1"
    local signal="${2:-TERM}"

    # Get all child processes
    local children
    children=$(pgrep -P "$pid" 2>/dev/null || true)

    # Kill children first (depth-first)
    for child in $children; do
        kill_process_tree "$child" "$signal"
    done

    # Kill the process itself
    if kill -0 "$pid" 2>/dev/null; then
        kill "-$signal" "$pid" 2>/dev/null || true
    fi
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

    # Graceful shutdown - kill entire process tree (SIGTERM)
    log_info "Stopping $name (PID: $pid) and child processes with SIGTERM..."
    kill_process_tree "$pid" "TERM"

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

    # Force kill entire tree (SIGKILL)
    log_warn "$name did not exit within ${GRACEFUL_TIMEOUT}s, sending SIGKILL..."
    kill_process_tree "$pid" "KILL"
    sleep 1

    if ! kill -0 "$pid" 2>/dev/null; then
        log_success "$name forcefully stopped"
        return 0
    else
        log_error "Failed to stop $name"
        return 1
    fi
}

# Clean up any orphaned dev server processes (project-specific matching)
cleanup_orphaned_dev_processes() {
    local orphan_pids

    # Match only processes running in our project directory
    orphan_pids=$(pgrep -f "comradarr.*vite.*dev" 2>/dev/null || true)

    # Also check for processes with our specific port
    if [[ -z "$orphan_pids" ]]; then
        orphan_pids=$(pgrep -f "vite.*dev.*5173" 2>/dev/null || true)
    fi

    # Fallback: check lsof for port 5173 owner
    if [[ -z "$orphan_pids" ]]; then
        local port_pid
        port_pid=$(lsof -t -i:5173 2>/dev/null || true)
        if [[ -n "$port_pid" ]]; then
            # Verify it's a vite/bun/node process before killing
            local cmd
            cmd=$(ps -p "$port_pid" -o comm= 2>/dev/null || true)
            if [[ "$cmd" == "node" ]] || [[ "$cmd" == "bun" ]]; then
                orphan_pids="$port_pid"
            fi
        fi
    fi

    if [[ -z "$orphan_pids" ]]; then
        return 0
    fi

    log_info "Cleaning up orphaned dev server processes..."

    for pid in $orphan_pids; do
        if kill -0 "$pid" 2>/dev/null; then
            log_info "Terminating orphaned process $pid"
            kill -TERM "$pid" 2>/dev/null || true
        fi
    done

    sleep 2

    # Force kill any remaining
    for pid in $orphan_pids; do
        if kill -0 "$pid" 2>/dev/null; then
            log_warn "Force killing orphaned process $pid"
            kill -9 "$pid" 2>/dev/null || true
        fi
    done
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

# Remove database from persistent credential storage
remove_db_credentials() {
    local db_name="$1"

    if [[ ! -f "$PERSISTENT_DBS_FILE" ]]; then
        return
    fi

    if ! command -v jq &> /dev/null; then
        return
    fi

    # Check if database exists in storage
    if ! jq -e --arg db "$db_name" '.[$db]' "$PERSISTENT_DBS_FILE" &>/dev/null; then
        return
    fi

    log_info "Removing saved credentials for '${db_name}'..."
    local temp_file
    temp_file=$(mktemp)
    jq --arg db "$db_name" 'del(.[$db])' "$PERSISTENT_DBS_FILE" > "$temp_file" && \
        mv "$temp_file" "$PERSISTENT_DBS_FILE"
}

# Cleanup database and user
cleanup_database() {
    local db_name="$1"
    local db_user="$2"
    local db_host="${3:-localhost}"
    local db_port="${4:-5432}"
    local persist_mode="${5:-false}"
    local reconnect_mode="${6:-false}"

    # Skip if persistent/reconnect and not forcing cleanup
    if [[ "$persist_mode" == "true" ]] && [[ "$FORCE_CLEANUP" != "true" ]]; then
        echo ""
        if [[ "$reconnect_mode" == "true" ]]; then
            log_info "Database '${db_name}' preserved (reconnect mode)"
        else
            log_info "Database '${db_name}' preserved (persistent mode)"
        fi
        log_info "Use --force-cleanup to remove"
        return 0
    fi

    log_info "Cleaning up database '${db_name}'..."

    local db_cleanup_success=false

    # Drop database
    if database_exists "$db_name" "$db_host" "$db_port" 2>/dev/null; then
        if run_psql_superuser "DROP DATABASE ${db_name};" "postgres" "$db_host" "$db_port"; then
            log_success "Database '${db_name}' dropped"
            db_cleanup_success=true
        else
            log_warn "Failed to drop database '${db_name}'"
        fi
    else
        log_info "Database '${db_name}' does not exist (already cleaned up)"
        db_cleanup_success=true
    fi

    # Drop user
    if [[ -n "$db_user" ]]; then
        if run_psql_superuser "DROP ROLE IF EXISTS ${db_user};" "postgres" "$db_host" "$db_port"; then
            log_success "User '${db_user}' dropped"
        else
            log_warn "Failed to drop user '${db_user}'"
        fi
    fi

    # Remove saved credentials only if database was successfully dropped
    if [[ "$db_cleanup_success" == "true" ]]; then
        remove_db_credentials "$db_name"
    else
        log_warn "Credentials preserved for '${db_name}' (database drop failed)"
    fi
}

# Validate database name matches safe identifier pattern
# Only allows comradarr_dev_ prefix followed by lowercase alphanumeric and underscores
is_safe_dev_db_name() {
    local name="$1"
    [[ "$name" =~ ^comradarr_dev_[a-z0-9_]+$ ]]
}

# Discover and cleanup ALL comradarr_dev_* databases (fallback when no state file)
discover_and_cleanup_all_dev_databases() {
    local db_host="${1:-localhost}"
    local db_port="${2:-5432}"

    log_info "Discovering all comradarr_dev_* databases..."

    # Get list of matching databases
    local dev_dbs
    dev_dbs=$(list_databases "$db_host" "$db_port" | cut -d \| -f 1 | grep "comradarr_dev_" | tr -d ' ' || true)

    if [[ -z "$dev_dbs" ]]; then
        log_info "No comradarr_dev_* databases found"
        return 0
    fi

    # Count and display
    local db_count
    db_count=$(echo "$dev_dbs" | wc -l | tr -d ' ')
    log_info "Found $db_count comradarr_dev_* database(s):"
    echo "$dev_dbs" | while read -r db; do
        echo "  - $db"
    done
    echo ""

    # Clean up each database
    local cleaned=0
    local failed=0

    while read -r db_name; do
        [[ -z "$db_name" ]] && continue

        # Validate database name matches safe pattern before SQL interpolation
        if ! is_safe_dev_db_name "$db_name"; then
            log_warn "Skipping '$db_name' - name doesn't match safe identifier pattern"
            failed=$((failed + 1))
            continue
        fi

        log_info "Cleaning up: $db_name"

        # Drop database
        if run_psql_superuser "DROP DATABASE ${db_name};" "postgres" "$db_host" "$db_port" 2>/dev/null; then
            log_success "  Database dropped"

            # Drop user (same name as database)
            if run_psql_superuser "DROP ROLE IF EXISTS ${db_name};" "postgres" "$db_host" "$db_port" 2>/dev/null; then
                log_success "  User dropped"
            fi

            # Remove saved credentials
            remove_db_credentials "$db_name"

            cleaned=$((cleaned + 1))
        else
            log_warn "  Failed to drop database"
            failed=$((failed + 1))
        fi
    done <<< "$dev_dbs"

    echo ""
    log_info "Cleanup summary: $cleaned dropped, $failed failed"
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
            local pid port db_name persist reconnect log_file timestamp

            pid=$(get_state_field "pid")
            port=$(get_state_field "port")
            db_name=$(get_state_field "dbName")
            persist=$(get_state_field "persistMode")
            reconnect=$(get_state_field "reconnectMode")
            log_file=$(get_state_field "logFile")
            timestamp=$(get_state_field "timestamp")

            # Determine mode label
            local mode_label
            if [[ "$reconnect" == "true" ]]; then
                mode_label="reconnect"
            elif [[ "$persist" == "true" ]]; then
                mode_label="persistent"
            else
                mode_label="ephemeral"
            fi

            echo ""
            echo "  PID:        $pid"
            echo "  Port:       $port"
            echo "  Database:   $db_name"
            echo "  Mode:       $mode_label"
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
    attempts to discover the dev server process automatically.

    Without --force-cleanup:
        - Stops any discovered dev server processes
        - Skips database cleanup (no database name available)
        - Suggests using --force-cleanup for full cleanup

    With --force-cleanup:
        - Stops any discovered dev server processes
        - Discovers ALL comradarr_dev_* databases in PostgreSQL
        - Drops each database and its associated user
        - Removes saved credentials from persistent storage
        - Provides detailed logging of what is being cleaned up

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
                # Clean up any orphaned child processes
                cleanup_orphaned_dev_processes
                echo ""
                log_success "Dev server stopped"
                echo ""

                # Handle database cleanup based on --force-cleanup flag
                if [[ "$FORCE_CLEANUP" == "true" ]]; then
                    log_info "Force cleanup requested - discovering orphaned databases..."
                    discover_and_cleanup_all_dev_databases
                else
                    log_warn "Database cleanup skipped (no state file)"
                    log_info "Use --force-cleanup to discover and remove all comradarr_dev_* databases"
                fi

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

            # Even without a running server, clean up databases if force-cleanup is requested
            if [[ "$FORCE_CLEANUP" == "true" ]]; then
                log_info "Force cleanup requested - discovering orphaned databases..."
                discover_and_cleanup_all_dev_databases
                echo ""
                check_orphaned_resources
            else
                log_info "The server may have already been stopped."
                log_info "Use './scripts/stop-dev.sh --status' to check for orphaned resources."
                log_info "Use './scripts/stop-dev.sh --force-cleanup' to clean up any orphaned databases."
            fi
            exit 0
        fi
    fi

    # Read state
    local pid sudo_pid db_name db_user db_host db_port log_file persist_mode reconnect_mode

    pid=$(get_state_field "pid")
    sudo_pid=$(get_state_field "sudoRefreshPid")
    db_name=$(get_state_field "dbName")
    db_user=$(get_state_field "dbUser")
    db_host=$(get_state_field "dbHost")
    db_port=$(get_state_field "dbPort")
    log_file=$(get_state_field "logFile")
    persist_mode=$(get_state_field "persistMode")
    reconnect_mode=$(get_state_field "reconnectMode")

    # Default values if not found
    db_host="${db_host:-localhost}"
    db_port="${db_port:-5432}"
    reconnect_mode="${reconnect_mode:-false}"

    # Stop dev server
    if [[ -n "$pid" ]]; then
        stop_process "$pid" "dev server"
    else
        log_warn "No PID found in state file"
    fi

    # Clean up any orphaned child processes
    cleanup_orphaned_dev_processes

    # Stop sudo refresh (Linux only)
    if [[ -n "$sudo_pid" ]] && [[ "$sudo_pid" != "0" ]] && [[ "$sudo_pid" != "null" ]]; then
        stop_process "$sudo_pid" "sudo refresh" 2>/dev/null || true
    fi

    echo ""

    # Handle database cleanup
    if [[ -n "$db_name" ]]; then
        cleanup_database "$db_name" "$db_user" "$db_host" "$db_port" "$persist_mode" "$reconnect_mode"
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
