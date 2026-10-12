import { useCallback, useEffect, useRef, useState } from "react";

interface PollingState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setData: (data: T) => void;
}

/**
 * Busca dados e repete a busca periodicamente. `intervalFor` recebe os dados
 * atuais e decide o intervalo (ms) — permitindo atualizar rápido enquanto há
 * tarefas em andamento e devagar quando tudo está parado. Retorne `null` para
 * não repetir.
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalFor: (data: T | null) => number | null,
): PollingState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  const intervalRef = useRef(intervalFor);
  fetcherRef.current = fetcher;
  intervalRef.current = intervalFor;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const sequence = useRef(0);

  const run = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    // Se outra busca começar antes desta terminar, apenas a mais recente agenda a próxima.
    const id = ++sequence.current;
    let next: T | null = null;
    try {
      next = await fetcherRef.current();
      if (!alive.current || id !== sequence.current) return;
      setData(next);
      setError(null);
    } catch (err) {
      if (!alive.current || id !== sequence.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (alive.current) setLoading(false);
    }
    if (!alive.current || id !== sequence.current) return;
    const delay = intervalRef.current(next);
    if (delay !== null) timer.current = setTimeout(() => void run(), delay);
  }, []);

  useEffect(() => {
    alive.current = true;
    void run();
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [run]);

  return { data, error, loading, refresh: run, setData };
}
