import { findMatches } from './articleSearch';

self.onmessage = event => {
 const { segments, query, options, scope } = event.data;
 const result = findMatches(segments, query, options, scope);
 // Replacement needs captures, not a copy of the entire input per match.
 for (const match of result.matches) delete (match.result as Partial<RegExpExecArray>).input;
 self.postMessage(result);
};
