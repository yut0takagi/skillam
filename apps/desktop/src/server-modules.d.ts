// apps/server is ESM and does not emit .d.ts files (declaration: false in
// its tsconfig), so these deep subpath imports resolve fine at runtime via
// plain Node module resolution but have no static types. Declare them as
// opaque `any` modules here rather than adding an exports map or type
// declarations to apps/server, which does not otherwise need them.
declare module '@skillam/server/dist/server-runtime.js'
declare module '@skillam/server/dist/db/client.js'
