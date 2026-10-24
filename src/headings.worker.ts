import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { documentHeadings, headingMarkdown } from './headings';
const parser = unified().use(remarkParse).use(remarkGfm);
self.onmessage = (event: MessageEvent<string>) => {
 self.postMessage(documentHeadings(parser.parse(headingMarkdown(event.data))));
};
