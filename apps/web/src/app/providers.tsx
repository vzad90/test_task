"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import superjson from "superjson";

import {
  DEFAULT_DEV_USER,
  DEV_USERS,
  readStoredSessionUser,
  SESSION_STORAGE_KEY,
  userById,
  type DevSessionUser,
} from "@/lib/session";
import { trpc } from "@/lib/trpc";

const SessionContext = createContext<{
  user: DevSessionUser;
  setUserId: (id: string) => void;
}>({
  user: DEFAULT_DEV_USER,
  setUserId: () => undefined,
});

export function useSession() {
  return useContext(SessionContext);
}

export function Providers({ children }: Readonly<{ children: ReactNode }>) {
  const [user, setUser] = useState<DevSessionUser>(readStoredSessionUser);
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          transformer: superjson,
          url: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/trpc",
          headers() {
            const session = readStoredSessionUser();
            return {
              "x-user-id": session.id,
              "x-user-role": session.role,
            };
          },
        }),
      ],
    }),
  );

  const sessionValue = useMemo(
    () => ({
      user,
      setUserId(id: string) {
        const next = userById(id);
        window.localStorage.setItem(SESSION_STORAGE_KEY, next.id);
        setUser(next);
      },
    }),
    [user],
  );

  return (
    <SessionContext.Provider value={sessionValue}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <div className="session-bar">
            <label>
              Acting as
              <select
                onChange={(event) => sessionValue.setUserId(event.target.value)}
                value={user.id}
              >
                {DEV_USERS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} ({option.role})
                  </option>
                ))}
              </select>
            </label>
          </div>
          {children}
        </QueryClientProvider>
      </trpc.Provider>
    </SessionContext.Provider>
  );
}
