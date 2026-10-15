import { revisionRows } from './diffRows';

self.onmessage = (event: MessageEvent<{ before: string; after: string }>) => {
 try { self.postMessage(revisionRows(event.data.before, event.data.after)); }
 catch { self.postMessage(null); }
};
