import type { Note } from './types';

// Records without a directory keep the original notes/ location.
export const notePath = (note: Pick<Note, 'filename' | 'directory'>) => `${note.directory || 'notes'}/${note.filename}`;
