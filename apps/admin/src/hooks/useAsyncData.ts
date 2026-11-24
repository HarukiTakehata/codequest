import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
}

export function useAsyncData<T>(loader: () => Promise<T>, deps: DependencyList, enabled = true) {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: true, error: null });

  useEffect(() => {
    if (!enabled) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let active = true;
    setState({ data: null, loading: true, error: null });
    void loaderRef.current().then(
      (data) => {
        if (active) setState({ data, loading: false, error: null });
      },
      (error: unknown) => {
        if (active) setState({ data: null, loading: false, error });
      },
    );
    return () => { active = false; };
    // deps 由调用方显式提供，revision 用于手动重试。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, revision, enabled]);

  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const updateData = useCallback((updater: (current: T | null) => T | null) => {
    setState((current) => ({ ...current, data: updater(current.data) }));
  }, []);
  return { ...state, reload, updateData };
}
