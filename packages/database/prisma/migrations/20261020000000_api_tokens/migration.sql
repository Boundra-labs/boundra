-- Bearer API tokens for SDK and MCP clients live beside browser sessions. Existing sessions are
-- browser sessions.
CREATE TYPE "SessionKind" AS ENUM ('COOKIE', 'TOKEN');

ALTER TABLE "AuthSession" ADD COLUMN "kind" "SessionKind" NOT NULL DEFAULT 'COOKIE';
