import { useState, useEffect, useRef, useCallback } from 'react';

export function useSSE(url, enabled = true) {
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef(null);

  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.addEventListener('scan_progress', (e) => {
      try {
        const data = JSON.parse(e.data);
        setEvents((prev) => [...prev.slice(-200), { type: 'scan_progress', data, ts: Date.now() }]);
      } catch {}
    });

    es.addEventListener('log', (e) => {
      try {
        const data = JSON.parse(e.data);
        setEvents((prev) => [...prev.slice(-200), { type: 'log', data, ts: Date.now() }]);
      } catch {}
    });

    es.addEventListener('campaign_progress', (e) => {
      try {
        const data = JSON.parse(e.data);
        setEvents((prev) => [...prev.slice(-200), { type: 'campaign_progress', data, ts: Date.now() }]);
      } catch {}
    });

    es.addEventListener('message', (e) => {
      try {
        const data = JSON.parse(e.data);
        setEvents((prev) => [...prev.slice(-200), { type: 'message', data, ts: Date.now() }]);
      } catch {}
    });

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [url, enabled]);

  const clearEvents = useCallback(() => setEvents([]), []);

  return { events, connected, clearEvents };
}
