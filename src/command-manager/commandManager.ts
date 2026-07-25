export type Command = {
  do: () => void;
  undo: () => void;
  label?: string;
  timestamp?: number;
};

export type HistoryState = {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
};

// Every entry holds closures over track snapshots, so an unbounded stack keeps
// deleted tracks alive for the whole session. Old entries are dropped instead.
const MAX_HISTORY = 50;

export class CommandManager {
  private past: Command[] = [];
  private future: Command[] = [];
  private listeners = new Set<(state: HistoryState) => void>();

  private notify() {
    const state = this.state;
    for (const listener of this.listeners) listener(state);
  }

  subscribe(listener: (state: HistoryState) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get state(): HistoryState {
    return {
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      undoLabel: this.past[this.past.length - 1]?.label,
      redoLabel: this.future[this.future.length - 1]?.label,
    };
  }

  execute(command: Command) {
    const stamped = { ...command, timestamp: Date.now() };
    stamped.do();
    this.past.push(stamped);
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.future = [];
    this.notify();
  }

  /** Returns the label of the undone command so callers can report it. */
  undo(): string | undefined {
    const command = this.past.pop();
    if (!command) {
      return undefined;
    }
    command.undo();
    this.future.push(command);
    if (this.future.length > MAX_HISTORY) this.future.shift();
    this.notify();
    return command.label;
  }

  /** Returns the label of the redone command so callers can report it. */
  redo(): string | undefined {
    const command = this.future.pop();
    if (!command) {
      return undefined;
    }
    command.do();
    this.past.push(command);
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.notify();
    return command.label;
  }

  clear() {
    this.past = [];
    this.future = [];
    this.notify();
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }
}

export const commandManager = new CommandManager();
