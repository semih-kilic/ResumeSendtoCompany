# Backend mirror

The canonical application entry point is at the repository root. The `app/` directory is retained as a compatibility mirror for existing scripts and deployments; new development should update and test the root files first.

For the supported setup and commands, see the root [`README.md`](../README.md). The primary backend modules are `server.js`, `db.js`, `config.js`, `scan-engine.js`, and `send-engine.js`.

The supported PM2 process name is `autonomous-outreach`:

```bash
pm2 start ../ecosystem.config.cjs
pm2 logs autonomous-outreach
pm2 status
```
