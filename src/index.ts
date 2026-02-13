
import * as fs from 'fs';
import * as path from 'path';
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

function collectTree(node: HtmlNode, arr: HtmlNode[] = []): HtmlNode[] {
	arr.push(node);
	for (const child of node.children) {
		collectTree(child, arr);
	}
	return arr;
}

const inputFileArg = process.argv[2];
if (!inputFileArg) {
	throw new Error('No input file provided. Usage: npm run dev -- <path/to/file.touch>');
}

const inputFilePath = path.resolve(process.cwd(), inputFileArg);
if (!fs.existsSync(inputFilePath)) {
	throw new Error(`Input file not found: ${inputFilePath}`);
}

let htmlContent = fs.readFileSync(inputFilePath, 'utf-8');
const tree = parseHtml(htmlContent);
const flatNodeArr = collectTree(tree);

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
htmlContent = stripBindingTextContent(tree, htmlContent);
htmlContent = wrapInputsWithForm(tree, htmlContent);
console.log(JSON.stringify(tree, null, 2));
traverseTree(tree);

function preprocessBindings(node: HtmlNode, html: string): string {
	let updatedHtml = html;
	const ensureId = () => {
		if (!node.id) {
			node.id = generateAutoId(node.tag);
			updatedHtml = addIdToHtml(updatedHtml, node.tag, node.content, node.id);
		}
	};

	ensureId();

	for (const child of node.children) {
		updatedHtml = preprocessBindings(child, updatedHtml);
	}

	return updatedHtml;
}

function wrapInputsWithForm(node: HtmlNode, html: string, inForm = false): string {
	let updatedHtml = html;
	const nextInForm = inForm || node.tag === 'form';

	if (node.tag === 'input' && node.onInput && !nextInForm && node.id) {
		const escapedId = escapeRegExp(node.id);
		const formId = `${node.id}__form`;
		const inputPattern = `<input\\b[^>]*\\bid\\s*=\\s*(?:"${escapedId}"|'${escapedId}')\\s*[^>]*>`;
		const inputRegex = new RegExp(inputPattern, 'i');
		updatedHtml = updatedHtml.replace(inputRegex, (match) => `<form id="${formId}">${match}</form>`);
	}

	for (const child of node.children) {
		updatedHtml = wrapInputsWithForm(child, updatedHtml, nextInForm);
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
	const attrPattern = '((?:[^>"\\\'{]|"[^"]*"|\'[^\']*\'|\\{[^}]*\\})*)';
	const tagPattern = `<${tag}${attrPattern}>\\s*${escapedContent}\\s*</${tag}>`;
	const regex = new RegExp(tagPattern, 'i');
	const updated = html.replace(regex, (match, attrs) => {
		if (/\bid\s*=/.test(attrs)) {
			return match;
		}
		return `<${tag}${attrs} id="${id}">${content}</${tag}>`;
	});

	if (updated !== html) {
		return updated;
	}

	const selfClosingPattern = `<${tag}${attrPattern}\\s*(/?)>`;
	const selfClosingRegex = new RegExp(selfClosingPattern, 'i');
	return html.replace(selfClosingRegex, (match, attrs, selfClose) => {
		if (/\bid\s*=/.test(attrs)) {
			return match;
		}
		let attrsText = attrs as string;
		let selfCloseFinal = selfClose as string;
		if (!selfCloseFinal && /\/\s*$/.test(attrsText)) {
			selfCloseFinal = '/';
			attrsText = attrsText.replace(/\s*\/\s*$/, '');
		}
		const spacer = attrsText === '' ? ' ' : /\s$/.test(attrsText) ? '' : ' ';
		return `<${tag}${attrsText}${spacer}id="${id}"${selfCloseFinal}>`;
	});
}

function stripDisplayIfAttributes(html: string): string {
	return html.replace(/\s*\bdisplay-if\s*=\s*(?:\{[^}]*\}|"[^"]*"|'[^']*'|[^\s"'>]+)/gi, '');
}

function stripBindAndOnInputAttributes(html: string): string {
	const withoutBind = html.replace(/\s*\bbind\s*=\s*(?:\{[^}]*\}|"[^"]*"|'[^']*'|[^\s"'>]+)/gi, '');
	const withoutOnInput = withoutBind.replace(/\s*\boninput\s*=\s*(?:\{[^}]*\}|"[^"]*"|'[^']*'|[^\s"'>]+)/gi, '');
	return withoutOnInput.replace(/\s*\bonclick\s*=\s*(?:\{[^}]*\}|"[^"]*"|'[^']*'|[^\s"'>]+)/gi, '');
}

function stripBindingTextContent(node: HtmlNode, html: string): string {
	let updatedHtml = html;
	if (node.content.startsWith('{') && node.content.endsWith('}') && node.id) {
		const escapedId = escapeRegExp(node.id);
		const escapedContent = escapeRegExp(node.content.trim());
		const attrPattern = '([^>]*?)';
		const tagPattern = `<${node.tag}\\b${attrPattern}\\bid\\s*=\\s*(?:"${escapedId}"|'${escapedId}')${attrPattern}>\\s*${escapedContent}\\s*<\\/${node.tag}>`;
		const regex = new RegExp(tagPattern, 'i');
		updatedHtml = updatedHtml.replace(regex, (match, beforeId, afterId) => {
			return `<${node.tag}${beforeId}id="${node.id}"${afterId}></${node.tag}>`;
		});
	}

	for (const child of node.children) {
		updatedHtml = stripBindingTextContent(child, updatedHtml);
	}

	return updatedHtml;
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
	if(node.displayIf !== undefined){
		const condition = node.displayIf.slice(1, -1).trim();
		bindings.push({
			id: `__binding__${bindings.length + 1}`,
			expression: condition,
			node,
			variables: variables.filter(v => condition.includes(v.name)).map(v => v.name)
		});
	}
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

// Add initializatio calls after all variable declarations
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
		console.log(binding.node)
		if(binding.node.displayIf !== undefined){
			const condition = binding.node.displayIf.slice(1, -1).trim();
			functionCode += `if(${condition}){\n`;
			functionCode += `\tdocument.getElementById("${binding.node.id}").style.display = "";\n`;
			functionCode += `} else {\n`;
			functionCode += `\tdocument.getElementById("${binding.node.id}").style.display = "none";\n`;
			functionCode += `}\n`;
			continue;
		}
		if(!binding.node.content.slice(1, -1).trim().includes(variable.name)) continue;
		functionCode += `document.getElementById("${binding.node.id}").textContent = ${binding.id}(${binding.variables.join(', ')})\n`
	}
	functionCode += "}\n";
	code = functionCode + code;
}
code = bindingFunctionsCode + code;

for(const node of flatNodeArr){
	if(node.tag === 'input' && node.bind){
		const varName = node.bind.slice(1, -1).trim();
		if(variables.some(v => v.name === varName)){
			code += `document.getElementById("${node.id}").addEventListener("input", (e) => { ${varName} = e.target.value; __update__${varName}(); });\n`;
		}	
	}
	if(node.tag === 'input' && node.onInput){
		const formId = `${node.id}__form`;
		let handlerCode = node.onInput.slice(1,-1).trim();
		for (const variable of variables) {
			handlerCode = addUpdateCalls(handlerCode, variable);
		}
		code += `document.getElementById("${formId}").addEventListener("submit", (e) => { e.preventDefault(); ${handlerCode} });\n`;
	}
	if(node.tag === 'button' && node.onClick){
		let handlerCode = node.onClick.slice(1,-1).trim();
		for (const variable of variables) {
			handlerCode = addUpdateCalls(handlerCode, variable);
		}
		code += `document.getElementById("${node.id}").addEventListener("click", (e) => { ${handlerCode} });\n`;
	}
}



scriptTag.content = code;
let updatedHtml = htmlContent.replace(
	/<script\b[^>]*>[\s\S]*?<\/script>/i,
	(scriptBlock) => {
		const openTagMatch = scriptBlock.match(/<script\b[^>]*>/i);
		const openTag = openTagMatch ? openTagMatch[0] : '<script>';
		return `${openTag}\n${code}\n</script>`;
	}
);

updatedHtml = stripDisplayIfAttributes(updatedHtml);
updatedHtml = stripBindAndOnInputAttributes(updatedHtml);

fs.writeFileSync('./out.html', updatedHtml, 'utf-8');