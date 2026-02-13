
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
type ForDirective = {
	id: string;
	item: string;
	arrayExpr: string;
	node: HtmlNode;
};
let forDirectives: ForDirective[] = [];

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

function toSafeIdentifier(value: string): string {
	return value.replace(/[^a-zA-Z0-9_]/g, '_');
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

function stripForAttributes(html: string): string {
	return html.replace(/\s+for\s*=\s*(?:\{[^}]*\}|"[^"]*"|'[^']*'|[^\s"'>]+)/gi, '');
}

function stripBindingTextContent(node: HtmlNode, html: string, insideFor = false): string {
	let updatedHtml = html;
	const hasFor = node.for !== undefined;
	if (!insideFor && !hasFor && node.content.startsWith('{') && node.content.endsWith('}') && node.id) {
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
		updatedHtml = stripBindingTextContent(child, updatedHtml, insideFor || hasFor);
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
		new RegExp(`\\b${name}\\s*(\\*\\*|[+\\-*/%])=\\s*[\\s\\S]*?;`, 'g'),
		(match) => `${match.replace(/;$/, '')}; ${updateCall}`
	);

	updated = updated.replace(
		new RegExp(`\\b${name}\\s*=\\s*[\\s\\S]*?;`, 'g'),
		(match, offset, fullText) => {
			const before = fullText.slice(0, offset as number);
			if (/\b(let|const|var)\s+$/.test(before)) {
				return match;
			}
			return `${match.replace(/;$/, '')}; ${updateCall}`;
		}
	);

	return updated;
}

function traverseTree(node: HtmlNode, insideFor = false) {
	const hasFor = node.for !== undefined;
	if (hasFor) {
		const forContent = node.for!.slice(1, -1).trim();
		const forMatch = forContent.match(/^(\w+)\s+in\s+([\s\S]+)$/);
		if (forMatch) {
			forDirectives.push({
				id: node.id ?? '',
				item: forMatch[1],
				arrayExpr: forMatch[2].trim(),
				node,
			});
		}
	}

	if (!insideFor && !hasFor) {
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
	}

	for(const child of node.children){
		traverseTree(child, insideFor || hasFor);
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

let forHelpersCode = '';
if (forDirectives.length > 0) {
	forHelpersCode += `function __renderTemplate__(template, scope){\n`;
	forHelpersCode += `\treturn template.replace(/\\{([^}]+)\\}/g, (_, expr) => {\n`;
	forHelpersCode += `\t\ttry {\n`;
	forHelpersCode += `\t\t\tconst keys = Object.keys(scope);\n`;
	forHelpersCode += `\t\t\tconst values = Object.values(scope);\n`;
	forHelpersCode += `\t\t\tconst fn = new Function(...keys, \`return (\${expr});\`);\n`;
	forHelpersCode += `\t\t\tconst result = fn(...values);\n`;
	forHelpersCode += `\t\t\treturn result ?? "";\n`;
	forHelpersCode += `\t\t} catch (e) {\n`;
	forHelpersCode += `\t\t\treturn "";\n`;
	forHelpersCode += `\t\t}\n`;
	forHelpersCode += `\t});\n`;
	forHelpersCode += `}\n`;
	forHelpersCode += `function __injectForAttr__(html, id){\n`;
	forHelpersCode += `\treturn html.replace(/^(<[^\\s>]+)/, '$1 data-touch-for="' + id + '"');\n`;
	forHelpersCode += `}\n`;
	forHelpersCode += `function __insertHtmlAfterMarker__(marker, html){\n`;
	forHelpersCode += `\tif (!marker || !marker.parentNode) return;\n`;
	forHelpersCode += `\tconst template = document.createElement('template');\n`;
	forHelpersCode += `\ttemplate.innerHTML = html;\n`;
	forHelpersCode += `\tconst parent = marker.parentNode;\n`;
	forHelpersCode += `\tconst next = marker.nextSibling;\n`;
	forHelpersCode += `\tparent.insertBefore(template.content, next);\n`;
	forHelpersCode += `}\n`;
}

let forRenderCode = '';
if (forDirectives.length > 0) {
	for (const directive of forDirectives) {
		if (!directive.id) {
			continue;
		}
		const safeId = toSafeIdentifier(directive.id);
		const scopePairs = variables.map(v => `${v.name}: ${v.name}`);
		const scopeObj = [`${directive.item}: item`, 'index', ...scopePairs].join(', ');
		forRenderCode += `const __for__template__${safeId} = document.getElementById("${directive.id}");\n`;
		forRenderCode += `const __for__parent__${safeId} = __for__template__${safeId} ? __for__template__${safeId}.parentElement : null;\n`;
		forRenderCode += `const __for__marker__${safeId} = document.createComment("touch-for:${directive.id}");\n`;
		forRenderCode += `const __for__template__${safeId}__html = __for__template__${safeId} ? __injectForAttr__(__for__template__${safeId}.outerHTML, "${directive.id}") : "";\n`;
		forRenderCode += `if (__for__parent__${safeId} && __for__template__${safeId}) {\n`;
		forRenderCode += `\t__for__parent__${safeId}.replaceChild(__for__marker__${safeId}, __for__template__${safeId});\n`;
		forRenderCode += `}\n`;
		forRenderCode += `function __render__for__${safeId}(){\n`;
		forRenderCode += `\tif (!__for__parent__${safeId}) return;\n`;
		forRenderCode += `\tconst __arr__ = (${directive.arrayExpr}) ?? [];\n`;
		forRenderCode += `\tArray.from(__for__parent__${safeId}.querySelectorAll('[data-touch-for="${directive.id}"]')).forEach(n => n.remove());\n`;
		forRenderCode += `\tlet __html__ = "";\n`;
		forRenderCode += `\tfor (let index = 0; index < __arr__.length; index += 1){\n`;
		forRenderCode += `\t\tconst item = __arr__[index];\n`;
		forRenderCode += `\t\tconst __scope__ = { ${scopeObj} };\n`;
		forRenderCode += `\t\t__html__ += __renderTemplate__(__for__template__${safeId}__html, __scope__);\n`;
		forRenderCode += `\t}\n`;
		forRenderCode += `\t__insertHtmlAfterMarker__(__for__marker__${safeId}, __html__);\n`;
		forRenderCode += `}\n`;
	}
}


for(const variable of variables){
	let functionCode = `function __update__${variable.name}(){\n`;
	for(const binding of bindings){
		console.log(binding.node)
		if(binding.node.displayIf !== undefined){
			const condition = binding.node.displayIf.slice(1, -1).trim();
			if (binding.expression === condition) {
				functionCode += `if(${condition}){\n`;
				functionCode += `\tdocument.getElementById("${binding.node.id}").style.display = "";\n`;
				functionCode += `} else {\n`;
				functionCode += `\tdocument.getElementById("${binding.node.id}").style.display = "none";\n`;
				functionCode += `}\n`;
				continue;
			}
		}
		if(!binding.node.content.slice(1, -1).trim().includes(variable.name)) continue;
		functionCode += `document.getElementById("${binding.node.id}").textContent = ${binding.id}(${binding.variables.join(', ')})\n`
	}
	for (const directive of forDirectives) {
		const varPattern = new RegExp(`\\b${variable.name}\\b`);
		if (varPattern.test(directive.arrayExpr)) {
			const safeId = toSafeIdentifier(directive.id);
			functionCode += `__render__for__${safeId}();\n`;
		}
	}
	functionCode += "}\n";
	code = functionCode + code;
}
code = bindingFunctionsCode + code;
code = forHelpersCode + forRenderCode + code;

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
updatedHtml = stripForAttributes(updatedHtml);

fs.writeFileSync('./out.html', updatedHtml, 'utf-8');