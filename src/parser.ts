import { HtmlNode } from './types';

const voidTags = new Set([
	'area',
	'base',
	'br',
	'col',
	'embed',
	'hr',
	'img',
	'input',
	'link',
	'meta',
	'param',
	'source',
	'track',
	'wbr',
]);

const normalizeTag = (tag: string) => tag.trim().toLowerCase();

const extractId = (raw: string): string | undefined => {
	const match = raw.match(/\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+))/i);
	return match?.[1] ?? match?.[2] ?? match?.[3];
};

const parseHtml = (html: string): HtmlNode => {
	const root: HtmlNode = { tag: '#document', content: '', children: [] };
	const stack: HtmlNode[] = [root];
	let index = 0;

	while (index < html.length) {
		const nextOpen = html.indexOf('<', index);
		if (nextOpen === -1) {
			const text = html.slice(index).trim();
			if (text) {
				stack[stack.length - 1].content += text;
			}
			break;
		}

		if (nextOpen > index) {
			const text = html.slice(index, nextOpen).trim();
			if (text) {
				stack[stack.length - 1].content += text;
			}
		}

		const close = html.indexOf('>', nextOpen + 1);
		if (close === -1) {
			break;
		}

		const rawTag = html.slice(nextOpen + 1, close).trim();

		if (!rawTag) {
			index = close + 1;
			continue;
		}

		if (rawTag.startsWith('!--')) {
			const commentEnd = html.indexOf('-->', close + 1);
			index = commentEnd === -1 ? html.length : commentEnd + 3;
			continue;
		}

		if (rawTag.startsWith('!')) {
			index = close + 1;
			continue;
		}

		if (rawTag.startsWith('/')) {
			const tagName = normalizeTag(rawTag.slice(1));
			while (stack.length > 1) {
				const current = stack.pop();
				if (current && normalizeTag(current.tag) === tagName) {
					break;
				}
			}
			index = close + 1;
			continue;
		}

		const selfClosing = rawTag.endsWith('/');
		const [tagNameRaw, ...rest] = rawTag.replace(/\/$/, '').split(/\s+/);
		const tagName = normalizeTag(tagNameRaw);
		const attrText = rest.join(' ');

		const node: HtmlNode = {
			tag: tagName,
			id: extractId(attrText),
			content: '',
			children: [],
		};

		stack[stack.length - 1].children.push(node);

		if (!selfClosing && !voidTags.has(tagName)) {
			stack.push(node);
		}

		index = close + 1;
	}

	return root;
};

export { parseHtml, type HtmlNode };
