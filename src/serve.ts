import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

const inputFileArg = process.argv[2];
if (!inputFileArg) {
	throw new Error('No input file provided. Usage: npm run serve -- <path/to/file.touch>');
}

const inputFilePath = path.resolve(process.cwd(), inputFileArg);
const outputFilePath = path.resolve(process.cwd(), 'out.html');

if (!fs.existsSync(inputFilePath)) {
	throw new Error(`Input file not found: ${inputFilePath}`);
}

let isBuilding = false;
let pendingBuild = false;

const runBuild = (): Promise<void> =>
	new Promise((resolve, reject) => {
		exec(`npm run dev -- "${inputFileArg}"`, { cwd: process.cwd() }, (err, stdout, stderr) => {
			if (stdout) {
				console.log(stdout.trim());
			}
			if (err) {
				console.error(stderr ? stderr.trim() : err.message);
				reject(err);
				return;
			}
			resolve();
		});
	});

const rebuild = async () => {
	if (isBuilding) {
		pendingBuild = true;
		return;
	}
	isBuilding = true;
	try {
		await runBuild();
		console.log(`[touch] rebuilt ${path.basename(inputFilePath)}`);
	} catch (err) {
		console.error('[touch] build failed');
	} finally {
		isBuilding = false;
		if (pendingBuild) {
			pendingBuild = false;
			rebuild();
		}
	}
};

const server = http.createServer((req, res) => {
	if (!fs.existsSync(outputFilePath)) {
		res.statusCode = 500;
		res.end('out.html not generated yet.');
		return;
	}
	const html = fs.readFileSync(outputFilePath);
	res.statusCode = 200;
	res.setHeader('Content-Type', 'text/html; charset=utf-8');
	res.end(html);
});

const port = Number(process.env.PORT ?? 3000);

server.listen(port, () => {
	console.log(`[touch] serving on http://localhost:${port}`);
});

rebuild();

const watcher = fs.watch(inputFilePath, { persistent: true }, () => {
	rebuild();
});

process.on('SIGINT', () => {
	watcher.close();
	server.close();
	process.exit(0);
});
