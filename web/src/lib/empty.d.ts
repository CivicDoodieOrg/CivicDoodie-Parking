/**
 * Mock Declaration File
 * 
 * This empty module is used as a compiler target path alias in web/tsconfig.json.
 * It mocks Node.js built-in modules (like `node:sqlite` and `node:async_hooks`)
 * which are referenced in better-auth type definitions (imported by the backend).
 * 
 * Because the frontend is a Browser SPA environment, it has no Node.js typings.
 * Mapping these Node imports to this empty file satisfies the compiler's module
 * resolution without polluting the frontend global scope with Node-specific types.
 */
export {};
