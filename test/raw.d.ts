// Vite's `?raw` imports, for tests that read source files as text. The app gets this from
// vite/client; the tests typecheck under tsconfig.worker.json, which doesn't include it.
declare module '*?raw' {
  const text: string
  export default text
}
