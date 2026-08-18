export interface DevSessionUser {
  id: string;
  name: string;
  role: "UNDERWRITER" | "SUPPORT";
}

export const DEFAULT_DEV_USER: DevSessionUser = {
  id: "user-underwriter-1",
  name: "Ada Underwriter",
  role: "UNDERWRITER",
};

export const DEV_USERS: DevSessionUser[] = [
  DEFAULT_DEV_USER,
  { id: "user-underwriter-2", name: "Grace Underwriter", role: "UNDERWRITER" },
  { id: "user-support-1", name: "Sam Support", role: "SUPPORT" },
];

export const SESSION_STORAGE_KEY = "loan-review.session-user-id";

export function userById(id: string | null | undefined): DevSessionUser {
  return DEV_USERS.find((user) => user.id === id) ?? DEFAULT_DEV_USER;
}

export function readStoredSessionUser(): DevSessionUser {
  if (typeof window === "undefined") {
    return DEFAULT_DEV_USER;
  }
  return userById(window.localStorage.getItem(SESSION_STORAGE_KEY));
}
