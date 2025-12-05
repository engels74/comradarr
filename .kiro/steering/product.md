# Comradarr Product Overview

Comradarr is a media library completion service that integrates with *arr applications (Sonarr, Radarr, Whisparr) to systematically identify and request missing or upgradeable content.

## Problem Solved

*arr applications only monitor RSS feeds for new releases and do not actively search for older missing content. Comradarr fills this gap by:

- Scanning libraries for content gaps (missing episodes/movies)
- Identifying upgrade candidates (items below quality cutoff)
- Queuing and dispatching search requests with intelligent rate limiting
- Respecting indexer rate limits to prevent bans

## Key Differentiator

Unlike similar tools that pollute *arr applications with tags to track state, Comradarr maintains all state in its own PostgreSQL database. This provides:

- Accurate episode-level tracking
- Clean separation of concerns
- Proper scalability for large libraries

## Core Concepts

- **Connectors**: Configured connections to *arr application instances (Sonarr, Radarr, Whisparr)
- **Sweep Cycles**: Scheduled operations that scan libraries for gaps or upgrade opportunities
- **Content Gaps**: Missing items (episodes not downloaded, movies not acquired)
- **Upgrade Candidates**: Existing items that could be replaced with higher quality versions
- **Throttle Profiles**: Rate-limiting configurations to prevent indexer bans
- **Request Queue**: Prioritized list of search requests processed according to throttle rules
