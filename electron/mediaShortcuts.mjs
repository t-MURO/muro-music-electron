const shortcuts = [
  { accelerator: "MediaPlayPause", action: "toggle" },
  { accelerator: "MediaNextTrack", action: "next" },
  { accelerator: "MediaPreviousTrack", action: "previous" },
];

export const registerMediaShortcuts = ({ globalShortcut, onAction }) => {
  const registeredAccelerators = [];

  for (const { accelerator, action } of shortcuts) {
    try {
      const registered = globalShortcut.register(accelerator, () => onAction(action));
      if (registered) {
        registeredAccelerators.push(accelerator);
      } else {
        console.warn(`Could not register media shortcut ${accelerator}`);
      }
    } catch (error) {
      console.warn(`Could not register media shortcut ${accelerator}:`, error);
    }
  }

  return {
    registeredAccelerators: [...registeredAccelerators],
    unregister() {
      for (const accelerator of registeredAccelerators) {
        globalShortcut.unregister(accelerator);
      }
      registeredAccelerators.length = 0;
    },
  };
};
