import { create } from "zustand";

export type Notification = {
  id: string;
  type: "success" | "error" | "info";
  message: string;
};

type NotificationState = {
  notifications: Notification[];
};

type NotificationActions = {
  addNotification: (type: Notification["type"], message: string) => void;
  removeNotification: (id: string) => void;
};

export type NotificationStore = NotificationState & NotificationActions;

let notificationId = 0;

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],

  addNotification: (type, message) => {
    const id = `notification-${++notificationId}`;
    set((state) => ({
      notifications: [...state.notifications, { id, type, message }],
    }));
  },

  removeNotification: (id) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },
}));

export const notify = {
  success: (message: string) =>
    useNotificationStore.getState().addNotification("success", message),
  error: (message: string) =>
    useNotificationStore.getState().addNotification("error", message),
  info: (message: string) =>
    useNotificationStore.getState().addNotification("info", message),
};
