export type Command = {
  do: () => void;
  undo: () => void;
  label?: string;
  timestamp?: number;
};

export class CommandManager {
  private past: Command[] = [];
  private future: Command[] = [];

  execute(command: Command) {
    const stamped = { ...command, timestamp: Date.now() };
    stamped.do();
    this.past.push(stamped);
    this.future = [];
  }

  undo() {
    const command = this.past.pop();
    if (!command) {
      return;
    }
    command.undo();
    this.future.push(command);
  }

  redo() {
    const command = this.future.pop();
    if (!command) {
      return;
    }
    command.do();
    this.past.push(command);
  }

  clear() {
    this.past = [];
    this.future = [];
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }
}

export const commandManager = new CommandManager();
