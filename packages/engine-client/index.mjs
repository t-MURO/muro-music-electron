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
  // Set once the engine can no longer answer; later requests fail with it.
  #closedError = null;
  #exitEmitted = false;

  constructor({ executablePath, args = [] }) {
    super();
    this.#child = spawn(executablePath, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const lines = readline.createInterface({ input: this.#child.stdout });
    lines.on("line", (line) => this.#route(line));
    this.#child.stderr.setEncoding("utf8");
    this.#child.stderr.on("data", (message) => this.emit("stderr", message));
    // A dying engine surfaces as EPIPE/ECONNRESET on its pipes. Unhandled
    // stream errors would crash the main process, so they shut the client
    // down instead and the owner recreates it on "exit".
    for (const stream of [this.#child.stdin, this.#child.stdout, this.#child.stderr]) {
      stream.on("error", (error) => this.#shutDown(
        new Error(`KeyFinder engine pipe failed: ${error.message}`, { cause: error }),
      ));
    }
    this.#child.on("error", (error) => {
      this.#shutDown(error);
      // A spawn failure may never be followed by "exit".
      if (this.#child.pid === undefined) this.#emitExit(null, null, error);
    });
    this.#child.once("exit", (code, signal) => {
      const error = new Error(`KeyFinder engine exited (${signal ?? code ?? "unknown"})`);
      this.#shutDown(error);
      this.#emitExit(code, signal, error);
    });
  }

  request(method, params = {}, { timeoutMs = 5_000 } = {}) {
    if (this.#closedError) return Promise.reject(this.#closedError);
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

  #shutDown(error) {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer());
      pending.reject(error);
    }
    this.#pending.clear();
    if (this.#closedError) return;
    this.#closedError = error;
    // A broken pipe leaves the engine unusable even if it is still running;
    // end it so "exit" fires and the owner can start a fresh one.
    // On Windows a graceful default kill can leave the native analyzer alive
    // after its Electron owner recycles it. SIGKILL maps to TerminateProcess and
    // guarantees that decoded-audio memory is released between batches.
    if (this.#child.exitCode === null && this.#child.signalCode === null && this.#child.pid !== undefined) {
      this.#child.kill("SIGKILL");
    }
  }

  #emitExit(code, signal, error) {
    if (this.#exitEmitted) return;
    this.#exitEmitted = true;
    this.emit("exit", { code, signal, error });
  }

  close() {
    if (this.#child.exitCode !== null || this.#child.signalCode !== null) return;
    this.#child.stdin.destroy();
    this.#shutDown(new Error("KeyFinder engine was closed"));
  }
}
