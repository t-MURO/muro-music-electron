import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";

const protocolVersion = 1;

const platformTriple = () => {
  if (process.platform === "win32") {
    return process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  }
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  return process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
};

export const resolveKeyFinderBinary = ({ directories = [] } = {}) => {
  const extension = process.platform === "win32" ? ".exe" : "";
  const names = [
    `keyfinder-native-${platformTriple()}${extension}`,
    `keyfinder-native-${process.arch}${extension}`,
    `keyfinder-native${extension}`,
  ];
  for (const directory of directories) {
    for (const name of names) {
      const candidate = path.resolve(directory, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error(`Could not find the KeyFinder engine in: ${directories.join(", ")}`);
};

export class KeyFinderClient extends EventEmitter {
  #child;
  #nextRequest = 1;
  #pending = new Map();

  constructor({ executablePath }) {
    super();
    this.#child = spawn(executablePath, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const lines = readline.createInterface({ input: this.#child.stdout });
    lines.on("line", (line) => this.#route(line));
    this.#child.stderr.setEncoding("utf8");
    this.#child.stderr.on("data", (message) => this.emit("stderr", message));
    this.#child.once("error", (error) => this.#failAll(error));
    this.#child.once("exit", (code, signal) => {
      const error = new Error(`KeyFinder engine exited (${signal ?? code ?? "unknown"})`);
      this.#failAll(error);
      this.emit("exit", { code, signal, error });
    });
  }

  request(method, params = {}, { timeoutMs = 5_000 } = {}) {
    const requestId = `electron-${this.#nextRequest++}`;
    const envelope = { version: protocolVersion, requestId, method, params };
    return new Promise((resolve, reject) => {
      let timer;
      const expire = () => {
        this.#pending.delete(requestId);
        reject(new Error(`KeyFinder ${method} request timed out`));
      };
      const refreshTimeout = () => {
        clearTimeout(timer);
        timer = setTimeout(expire, timeoutMs);
      };
      refreshTimeout();
      this.#pending.set(requestId, {
        resolve,
        reject,
        timer: () => timer,
        refreshTimeout,
        method,
        owner: params.owner,
      });
      this.#child.stdin.write(`${JSON.stringify(envelope)}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.#pending.delete(requestId);
        reject(error);
      });
    });
  }

  health() {
    return this.request("health", {}, { timeoutMs: 5_000 });
  }

  #route(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.emit("protocolError", new Error(`KeyFinder returned invalid JSON: ${error.message}`));
      return;
    }
    if (!message.requestId && message.event) {
      for (const pending of this.#pending.values()) {
        if (pending.method === "startAnalysis" && pending.owner === message.owner) {
          pending.refreshTimeout();
        }
      }
      this.emit("event", message);
      return;
    }
    const pending = this.#pending.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timer());
    this.#pending.delete(message.requestId);
    if (message.version !== protocolVersion) {
      pending.reject(new Error("KeyFinder returned an unsupported protocol version"));
    } else if (message.error) {
      pending.reject(new Error(`${message.error.code ?? "NATIVE_ERROR"}: ${message.error.message ?? "Native engine error"}`));
    } else if (Object.hasOwn(message, "result")) {
      pending.resolve(message.result);
    } else {
      pending.reject(new Error("KeyFinder returned an invalid response envelope"));
    }
  }

  #failAll(error) {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer());
      pending.reject(error);
    }
    this.#pending.clear();
  }

  close() {
    if (this.#child.exitCode !== null || this.#child.signalCode !== null) return;
    this.#child.stdin.destroy();
    // On Windows a graceful default kill can leave the native analyzer alive
    // after its Electron owner recycles it. SIGKILL maps to TerminateProcess and
    // guarantees that decoded-audio memory is released between batches.
    this.#child.kill("SIGKILL");
  }
}
