/**
 * Global Type Definitions for the Frontend Workspace
 * 
 * This file contains ambient declarations for global constants and overrides
 * designed to resolve type-checking conflicts between Cloudflare Workers types (backend)
 * and Browser DOM types (frontend) when importing `AppType` for Hono RPC.
 */

declare global {
  // Global version and git hash variables injected by Vite at build time
  const __APP_VERSION__: string;
  const __GIT_REF__: string;
  const __AUTH_BASE_URL__: string;

  /**
   * Mock of Cloudflare's D1Database interface.
   * 
   * When compiling the backend routes to infer the Hono AppType, the frontend compiler
   * walks database queries. These minimal mock definitions (along with the catch-all
   * index signature) prevent compilation errors and satisfy third-party dialect libraries
   * (like Kysely's D1Dialect) without loading the conflicting Cloudflare Workers types globally.
   */
  interface D1Database {
    prepare(query: string): D1PreparedStatement;
    batch(queries: any[]): Promise<any[]>;
    exec(query: string): Promise<any>;
    dump(): Promise<ArrayBuffer>;
    withSession(options: any): any;
    [key: string]: any;
  }

  interface D1PreparedStatement {
    bind(...args: any[]): D1PreparedStatement;
    all<T = any>(): Promise<{ results: T[]; success: true; meta: any }>;
    first<T = any>(): Promise<T | null>;
    raw<T = any>(): Promise<[string[], ...T[]]>;
    run(): Promise<any>;
    [key: string]: any;
  }

  /**
   * Mock types for Cloudflare Worker bindings.
   * 
   * Overrides standard DOM types for Request, Response, Headers, and ReadableStream 
   * with `any` in this compilation scope to bypass strict signature matching.
   * This is necessary because Hono routes and middleware return Cloudflare-specific Response/Request
   * objects which have slight property differences compared to the standard browser versions.
   */
  type R2Bucket = any;
  type Fetcher = any;
  type Request = any;
  type Response = any;
  type Headers = any;
  type ReadableStream<R = any> = any;
}

export {};
