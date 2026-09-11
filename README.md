<div align="center">
  <img src="public/comradarr-icon.svg" alt="Comradarr Icon" width="240" height="240" />

# Comradarr (WIP)

[![License](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](LICENSE)

</div>

Comradarr is a planned media library completion service for identifying and requesting missing or upgradeable content through *arr applications.

**Planning only: this repository does not currently contain a functional application.**
There is no backend, frontend, runnable container or deployment in `main`.

## Documentation

- [Product requirements](docs/comradarr-prd.md)
- [Implementation plan](docs/comradarr-implementation-plan.md)

The documents are preserved from `feat/comradarr-implementation-plan`. Their
implementation checkboxes, commands and references describe earlier work and future
design; they do not establish functionality in the current planning-only tree.
The original implementation branch and history remain available for reference.

## Repository checks

`prek run --all-files` checks repository content on a working branch. CI runs the
same content checks, skipping only the local restriction on committing to `main`.
Renovate uses the shared repository maintenance configuration. There are no
application build, runtime or deployment jobs.

## License

[GNU Affero General Public License v3.0](LICENSE).
