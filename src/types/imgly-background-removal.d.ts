// Type stub cho @imgly/background-removal (WASM package).
// Package sẽ được install khi network khả dụng: npm install @imgly/background-removal
// Stub này cho phép tsc pass mà không cần package thật.

declare module "@imgly/background-removal" {
  interface RemoveBackgroundOptions {
    output?: { format?: string };
    model?: "small" | "medium" | "large";
  }
  export function removeBackground(
    image: Blob | string | URL,
    options?: RemoveBackgroundOptions,
  ): Promise<Blob>;
}
