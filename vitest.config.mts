import { defineConfig } from 'vitest/config'

// Running `npx vitest run` from the repository root used to load no config at
// all: every workspace's environment setting was ignored, so the web tests ran
// under node and failed with `document is not defined`. A wall of red that
// says nothing about the code reads as "the tests are broken" — one such run
// was misread as 104 real failures.
//
// Naming the projects here makes the root command load each workspace's own
// config, so `npx vitest run` and `npm test` agree.
//
// `.mts` rather than `.ts`: the root package.json has no `"type": "module"`
// (the workspaces set it individually), so a `.ts` config is loaded as
// CommonJS and Vite warns about the ESM syntax. Adding `"type": "module"` at
// the root would change how every root-level `.js` file is interpreted, which
// is a much wider blast radius than one config file's extension.
export default defineConfig({
  test: {
    projects: ['apps/server', 'apps/web']
  }
})
