import { useEffect, useState } from 'react';

// Statistics and preview rendering may wait briefly; a different document is immediate.
export function useSettledValue<T>(value: T, key: string, delay = 150) {
 const [settled, setSettled] = useState({ key, value });
 useEffect(() => {
  const timer = setTimeout(() => setSettled({ key, value }), delay);
  return () => clearTimeout(timer);
 }, [value, key, delay]);
 return settled.key === key ? settled.value : value;
}
