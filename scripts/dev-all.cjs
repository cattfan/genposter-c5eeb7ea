// Spawn cả backend (NestJS) + frontend (Vite) cùng 1 process.
// Dùng cho `npm run dev` ở root: thay vì chỉ chạy Vite, chạy cả 2.
//
// Khi user nhấn Ctrl+C, kill cả 2 child process gọn gàng.
// Output 2 process được prefix [backend] / [frontend] để phân biệt.

const { spawn } = require("child_process");
const path = require("path");

const isWindows = process.platform === "win32";
const npmCmd = isWindows ? "npm.cmd" : "npm";

const procs = [];

function start(label, cwd, args, color) {
  const child = spawn(npmCmd, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  const prefix = `\x1b[${color}m[${label}]\x1b[0m`;

  child.stdout.on("data", (chunk) => {
    process.stdout.write(prefixLines(prefix, chunk.toString()));
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(prefixLines(prefix, chunk.toString()));
  });
  child.on("exit", (code, signal) => {
    console.log(`${prefix} exited (code=${code}, signal=${signal})`);
    // Khi 1 process chết, tắt cả 2 để user biết và restart cả cụm.
    shutdown(code ?? 1);
  });
  procs.push({ child, label });
  return child;
}

function prefixLines(prefix, text) {
  return text
    .split(/\r?\n/)
    .map((line, i, arr) => (i === arr.length - 1 && line === "" ? "" : `${prefix} ${line}`))
    .join("\n");
}

function shutdown(exitCode) {
  for (const { child } of procs) {
    if (!child.killed) {
      try {
        // Windows: gọi taskkill /T để kill cả tree (npm spawn nhiều child).
        if (isWindows) {
          spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
        } else {
          child.kill("SIGTERM");
        }
      } catch {
        // ignore
      }
    }
  }
  setTimeout(() => process.exit(exitCode ?? 0), 200);
}

process.on("SIGINT", () => {
  console.log("\n[dev] Ctrl+C: dừng backend + frontend...");
  shutdown(0);
});
process.on("SIGTERM", () => shutdown(0));

console.log("[dev] Khoi dong backend (port 3001) + frontend (port 9090)...");

start("backend", path.join(__dirname, "..", "backend"), ["run", "dev"], "36"); // cyan
// Delay frontend 1.5s de backend listen truoc -> giam ECONNREFUSED proxy.
setTimeout(() => {
  start("frontend", path.join(__dirname, ".."), ["run", "dev:vite"], "35"); // magenta
}, 1500);
