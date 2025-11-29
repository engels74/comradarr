# Comradarr

Comradarr is a media library completion service that integrates with *arr applications (Sonarr, Radarr, Whisparr) to systematically identify and request missing or upgradeable content.

## Problem Solved

*arr applications only monitor RSS feeds for new releases—they don't actively search for older missing content. Comradarr fills this gap by running scheduled sweeps to find content gaps and upgrade candidates.

## Key Differentiator

Unlike similar tools that pollute *arr apps with tags to track state, Comradarr maintains all state in its own PostgreSQL database. This provides:
- Accurate episode-level tracking
- Clean separation of concerns
- Proper scalability for large libraries
- Content mirror can be rebuilt from *arr APIs without losing operational history

## Core Concepts

- **Connectors**: Configured connections to *arr application instances (URL, encrypted API key, type, settings)
- **Sweep Cycles**: Scheduled operations scanning for content gaps or upgrade opportunities (cron-based with timezone awareness)
- **Content Gaps**: Missing items where `monitored=true` AND `hasFile=false`
- **Upgrade Candidates**: Items where `monitored=true` AND `qualityCutoffNotMet=true`
- **Throttle Profiles**: Rate-limiting (requests/minute, batch size, cooldowns, daily budget)
- **Request Queue**: Prioritized list with priority based on content age, missing duration, failure penalty, search type
- **Content Mirror**: Local database copy of *arr library state for efficient gap detection
- **Search State**: Tracks Comradarr's actions separately from content state (pending → queued → searching → cooldown/exhausted)
- **Search Registry**: Records with content reference, search type, state, attempt counter, timestamps, priority

## Key Features

- Episode batching: SeasonSearch for fully-aired seasons above threshold, EpisodeSearch otherwise
- Season pack fallback to individual episodes after failure
- Exponential backoff on search failures
- Exhaustion at max retry attempts
- Notifications: Discord, Telegram, Slack, Pushover, Gotify, ntfy, email, webhooks
- Analytics: gap discovery rate, search volume, success rate, queue depth
- Health checks with connector status (healthy, degraded, unhealthy, offline)

## License

AGPL-3.0
