// Mount a React element off-screen at native size, wait for DOM + fonts +
// images to settle, and hand back the root HTMLElement. Used by export paths
// that need to render at logical template size (e.g. 1080x1350) instead of
// the CSS-scaled preview node shown in the UI.

import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitForFirstChild(mount: HTMLElement, maxFrames = 60): Promise<HTMLElement> {
  for (let i = 0; i < maxFrames; i++) {
    const child = mount.firstElementChild as HTMLElement | null;
    if (child) return child;
    await nextFrame();
  }
  throw new Error("Không render được page (timeout waiting for child)");
}

async function waitForNodeToSettle(node: HTMLElement): Promise<void> {
  await nextFrame();
  await nextFrame();
  await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;

  const images = Array.from(node.querySelectorAll("img"));
  await Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }
          image.onload = () => resolve();
          image.onerror = () => resolve();
        }),
    ),
  );
}

export async function renderReactNodeOffDom(
  element: ReactNode,
): Promise<{ node: HTMLElement; cleanup: () => void }> {
  const mount = document.createElement("div");
  mount.style.position = "fixed";
  mount.style.left = "-20000px";
  mount.style.top = "0";
  mount.style.pointerEvents = "none";
  document.body.appendChild(mount);
  const root = createRoot(mount);
  root.render(element);
  try {
    const node = await waitForFirstChild(mount);
    await waitForNodeToSettle(node);
    return {
      node,
      cleanup: () => {
        root.unmount();
        mount.remove();
      },
    };
  } catch (err) {
    root.unmount();
    mount.remove();
    throw err;
  }
}
