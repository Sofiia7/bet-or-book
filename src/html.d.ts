declare module '*.html' {
  const content: string;
  export default content;
}

declare module '*/web/app.js' {
  const content: string;
  export default content;
}

// The two fonts satori needs and the static fallback picture: raw bytes,
// per the `Data` rule in wrangler.toml.
declare module '*.woff' {
  const content: ArrayBuffer;
  export default content;
}

declare module '*.png' {
  const content: ArrayBuffer;
  export default content;
}

// Wrangler compiles a `.wasm` import to a WebAssembly.Module at build time -
// there is no bundler-agnostic type for that import shape, hence the
// `@ts-expect-error` at the one place this is imported instead of a blanket
// module declaration that would silently accept any other shape too.
