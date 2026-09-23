# bun global install layout

Verified against a real `bun add -g @dbx-app/mcp-server@0.4.93` (bun 1.4.2,
macOS) with an isolated `BUN_INSTALL`:

- `<BUN_INSTALL>/bin/dbx-mcp-server` is a relative symlink to
  `../install/global/node_modules/@dbx-app/mcp-server/bin/dbx-mcp-server.js`
- `<BUN_INSTALL>/install/global/package.json` records the dependency
  (`{"dependencies":{"@dbx-app/mcp-server":"^0.4.93"}}`)
- packages and their platform binaries are hoisted flat under
  `<BUN_INSTALL>/install/global/node_modules`
- on Windows bun writes opaque `dbx-mcp-server.exe` / `.bunx` launchers
  instead of symlinks, so the package has to be recovered from the layout

The unit tests in `src/commands/mcp.rs` recreate this layout in a temp dir.
