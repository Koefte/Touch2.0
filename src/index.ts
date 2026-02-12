
import * as fs from 'fs';
import { HtmlNode, parseHtml } from './parser';
import { Variable } from './types';

let autoIdCounter = 0;

function findTag(node: HtmlNode, tagName: string): HtmlNode | null {
	if (node.tag === tagName) {
		return node;
	}
	for (const child of node.children) {
		const found = findTag(child, tagName);
		if (found) {
			return found;
		}
	}
	return null;
}


let htmlContent = fs.readFileSync('./index.touch', 'utf-8');
const tree = parseHtml(htmlContent);


const scriptTag = findTag(tree, 'script');
if(!scriptTag){
	throw new Error('No <script> tag found in the document.');
}
let variables: Variable[] = [];
let bindings: Variable['bindings'] = [];

const variableRegex = /Touch\s+(\w+)\s*=\s*([^;]+);/g;
let match: RegExpExecArray | null;
while ((match = variableRegex.exec(scriptTag.content)) !== null) {
	const varName = match[1];
	const varValue = match[2].trim();
	variables.push({ name: varName, startingValue: varValue, bindings: [] });
}

htmlContent = preprocessBindings(tree, htmlContent);
traverseTree(tree);

function preprocessBindings(node: HtmlNode, html: string): string {
	let updatedHtml = html;
	const ensureId = () => {
		if (!node.id) {
			node.id = generateAutoId(node.tag);
			updatedHtml = addIdToHtml(updatedHtml, node.tag, node.content, node.id);
		}
	};

	if (node.content.startsWith('{') && node.content.endsWith('}')) {
		ensureId();
	}

	for (const child of node.children) {
		updatedHtml = preprocessBindings(child, updatedHtml);
	}

	return updatedHtml;
}

function generateAutoId(tag: string): string {
	autoIdCounter += 1;
	return `touch-${tag}-${autoIdCounter}`;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function addIdToHtml(html: string, tag: string, content: string, id: string): string {
	const escapedContent = escapeRegExp(content.trim());
	const tagPattern = `<${tag}([^>]*)>\\s*${escapedContent}\\s*</${tag}>`;
	const regex = new RegExp(tagPattern, 'i');
	return html.replace(regex, (match, attrs) => {
		if (/\bid\s*=/.test(attrs)) {
			return match;
		}
		return `<${tag}${attrs} id="${id}">${content}</${tag}>`;
	});
}

function addUpdateCalls(source: string, variable: Variable): string {
	const name = variable.name;
	const updateCall = `__update__${name}();`;
	let updated = source;

	updated = updated.replace(new RegExp(`\\b${name}\\s*\\+\\+;?`, 'g'), `${name}++; ${updateCall}`);
	updated = updated.replace(new RegExp(`\\+\\+\\s*${name}\\b;?`, 'g'), `${name}++; ${updateCall}`);
	updated = updated.replace(new RegExp(`\\b${name}\\s*--;?`, 'g'), `${name}--; ${updateCall}`);
	updated = updated.replace(new RegExp(`--\\s*${name}\\b;?`, 'g'), `${name}--; ${updateCall}`);

	updated = updated.replace(
		new RegExp(`\\b${name}\\s*(\\*\\*|[+\\-*/%])=\\s*[^;\\n]+;?`, 'g'),
		(match) => `${match.replace(/;?$/, '')}; ${updateCall}`
	);

	updated = updated.replace(
		new RegExp(`\\b${name}\\s*=\\s*[^;\\n]+;?`, 'g'),
		(match, offset, fullText) => {
			const before = fullText.slice(0, offset as number);
			if (/\b(let|const|var)\s+$/.test(before)) {
				return match;
			}
			return `${match.replace(/;?$/, '')}; ${updateCall}`;
		}
	);

	return updated;
}

function traverseTree(node: HtmlNode) {
	if(node.content.startsWith('{') && node.content.endsWith('}')){
		// Construct a function that evaluates the expression inside the curly braces
		const expression = node.content.slice(1, -1).trim();
		bindings.push({
			id: `__binding__${bindings.length + 1}`,
			expression,
			node,
			variables: variables.filter(v => expression.includes(v.name)).map(v => v.name)
		});
	}

	for(const child of node.children){
		traverseTree(child);
	}
}

let code = scriptTag.content;
for(const variable of variables){
	code = code.replace(new RegExp(`Touch\\s+${variable.name}\\s*=\\s*[^;]+;`), `let ${variable.name} = ${variable.startingValue};`);
}

for (const variable of variables) {
	code = addUpdateCalls(code, variable);
}

// Add initialization calls after all variable declarations
if (variables.length > 0) {
	const lastVar = variables[variables.length - 1];
	const initCalls = variables.map(v => `__update__${v.name}();`).join('\n');
	code = code.replace(
		new RegExp(`(let\\s+${lastVar.name}\\s*=\\s*[^;\\n]+;)`),
		`$1\n${initCalls}`
	);
}

let bindingFunctionsCode = '';
for (const binding of bindings) {
	bindingFunctionsCode += `function ${binding.id}(${binding.variables.join(', ')}){\n`;
	bindingFunctionsCode += `\treturn ${binding.expression};\n`;
	bindingFunctionsCode += `}\n`;
}


for(const variable of variables){
	let functionCode = `function __update__${variable.name}(){\n`;
	for(const binding of bindings){
		if(!binding.node.content.slice(1, -1).trim().includes(variable.name)) continue;
		functionCode += `document.getElementById("${binding.node.id}").textContent = ${binding.id}(${binding.variables.join(', ')})\n`
	}
	functionCode += "}\n";
	code = functionCode + code;
}
code = bindingFunctionsCode + code;
scriptTag.content = code;

const updatedHtml = htmlContent.replace(
	/<script\b[^>]*>[\s\S]*?<\/script>/i,
	(scriptBlock) => {
		const openTagMatch = scriptBlock.match(/<script\b[^>]*>/i);
		const openTag = openTagMatch ? openTagMatch[0] : '<script>';
		return `${openTag}\n${code}\n</script>`;
	}
);

fs.writeFileSync('./out.html', updatedHtml, 'utf-8');