import { create } from "zustand";

export type NotificationAction = {
  label: string;
  onClick: () => void;
};

export type NotificationOptions = {
  /** Replaces the notification with the same key instead of stacking a new one. */
  key?: string;
  /** Short per-item lines shown under the message, e.g. which files failed. */
  details?: string[];
  action?: NotificationAction;
  /** Further buttons shown after `action`. */
  actions?: NotificationAction[];
  /** Keeps the toast until the user dismisses it or it is replaced. */
  sticky?: boolean;
  /** Runs when the user closes the toast, not when it times out or is replaced. */
  onDismiss?: () => void;
};

export type Notification = {
  id: string;
  type: "success" | "error" | "info";
  message: string;
} & Omit<NotificationOptions, "key">;

type NotificationState = {
  notifications: Notification[];
};

type NotificationActions = {
  addNotification: (
    type: Notification["type"],
    message: string,
    options?: NotificationOptions,
  ) => string;
  removeNotification: (id: string) => void;
};

export type NotificationStore = NotificationState & NotificationActions;

let notificationId = 0;

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],

  addNotification: (type, message, options = {}) => {
    const { key, ...rest } = options;
    const id = key ?? `notification-${++notificationId}`;
    const notification: Notification = { id, type, message, ...rest };
    set((state) => {
      const index = state.notifications.findIndex((n) => n.id === id);
      if (index === -1) {
        return { notifications: [...state.notifications, notification] };
      }
      const notifications = [...state.notifications];
      notifications[index] = notification;
      return { notifications };
    });
    return id;
  },

  removeNotification: (id) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },
}));

export const notify = {
  success: (message: string, options?: NotificationOptions) =>
    useNotificationStore.getState().addNotification("success", message, options),
  error: (message: string, options?: NotificationOptions) =>
    useNotificationStore.getState().addNotification("error", message, options),
  info: (message: string, options?: NotificationOptions) =>
    useNotificationStore.getState().addNotification("info", message, options),
};
