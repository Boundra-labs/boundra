# Boundra MCP server

Lets an AI assistant (Claude or any MCP client) work with Boundra over stdio. **Base Sepolia testnet only**: MockUSDC and mock vaults, no real funds.

It never holds an owner's wallet key and has no tool that approves a mandate or signs for the owner. Owners approve in the Boundra app and sign in their own wallet.

## Tools

| Tool                           | Needs       | What it does                                                                                              |
| ------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------- |
| `boundra_get_overview`         | owner token | Executor, current mandate, funds, positions and chain status                                              |
| `boundra_list_activity`        | owner token | Timeline, newest first; transaction links only for real transactions                                      |
| `boundra_get_mandate`          | owner token | Exact limits and the notices the owner sees                                                               |
| `boundra_start_goal`           | owner token | Starts a goal and returns the first clarifying question for the owner                                     |
| `boundra_answer_question`      | owner token | Records the owner's answer ("unsure" always allowed)                                                      |
| `boundra_draft_mandate`        | owner token | Drafts or revises a mandate, optionally naming the owner's own agent; links to the app for approval       |
| `boundra_prepare_owner_action` | owner token | Pause, resume, revoke, recoverIdle or ownerWithdraw as an **unsigned** transaction for the owner's wallet |
| `boundra_operator_status`      | agent key   | What an owner's mandate lets this agent do now, per vault, and why not                                    |
| `boundra_deposit`              | agent key   | Deposits within the mandate, checked and simulated first; the executor contract enforces it on chain      |
| `boundra_withdraw`             | agent key   | Withdraws within the mandate; the executor always pays the owner                                          |

Without an owner token, `boundra_get_overview` explains how to get one.

## Configuration

| Variable                    | For            | Notes                                                                                                         |
| --------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------- |
| `BOUNDRA_APP_URL`           | all            | The Boundra app's origin, e.g. `https://boundra.example` (default `http://localhost:3000`)                    |
| `BOUNDRA_API_TOKEN`         | owner tools    | Created by the owner in the app: **Connect an app or AI assistant**. Lasts 12 hours; revocable there          |
| `BOUNDRA_AGENT_PRIVATE_KEY` | operator tools | The agent's **own** key, funded with a little Base Sepolia ETH. Never the owner's, deployer's or risk admin's |
| `BOUNDRA_MANIFEST_PATH`     | operator tools | The reviewed deployment manifest, e.g. `deploy/manifests/base-sepolia.json`                                   |
| `BOUNDRA_RPC_URL`           | operator tools | Base Sepolia RPC (default `https://sepolia.base.org`)                                                         |

The owner names the agent's address as the mandate's operator (in a draft, `operator`), approves it in the app and signs `setMandate` in their wallet. Until then the agent can do nothing.

## Run it

```sh
pnpm build:packages && pnpm --filter @boundra/mcp build
```

Claude Code:

```sh
claude mcp add boundra -e BOUNDRA_APP_URL=https://boundra.example -e BOUNDRA_API_TOKEN=<token> -- node /path/to/boundra/apps/mcp/dist/main.js
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "boundra": {
      "command": "node",
      "args": ["/path/to/boundra/apps/mcp/dist/main.js"],
      "env": { "BOUNDRA_APP_URL": "https://boundra.example", "BOUNDRA_API_TOKEN": "<token>" }
    }
  }
}
```

Tests: `pnpm --filter @boundra/mcp test` connects a real MCP client in memory to the server with fake API and operator back ends. The operator itself is tested against the contracts in `@boundra/sdk`'s chain test.
