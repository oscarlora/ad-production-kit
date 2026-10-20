// Brand data is reached at runtime (lib/server/tools.js), so bundling and tracing stay scoped to studio/.
const appDir = import.meta.dirname;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // dev.mjs sets NEXT_DIST_DIR per port: Next allows one server per build dir.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  outputFileTracingRoot: appDir,
  // Brand files are read via runtime paths; stop the tracer globbing the app dir.
  outputFileTracingExcludes: { '*': ['./**'] },
  turbopack: { root: appDir },
  // The chat's SDK starts Claude Code from its own package folder, so it must not be bundled.
  serverExternalPackages: ['@anthropic-ai/claude-agent-sdk'],
  agentRules: false, // dev mode would otherwise write studio/AGENTS.md
};

export default nextConfig;
