import * as fs from 'fs';
import * as readline from 'readline';
import * as npath from 'path';

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});
rl.question('Notion Export Path:\n', (path) => {
	const start = Date.now();
	const output = fixNotionExport(path.trim());
	const elapsed = Date.now() - start;

	console.log(
		`Fixed in ${elapsed}ms
${'-'.repeat(8)}
Directories: ${output.directories.length}
Files: ${output.files.length}
Markdown Links: ${output.markdownLinks}
CSV Links: ${output.csvLinks}`
	);

	rl.close();
});

const truncateFileName = (fileName: string) => {
	return fileName.substring(0, fileName.lastIndexOf(' ')) + fileName.substring(fileName.indexOf('.'));
};

const truncateDirName = (directoryName: string) => {
	return directoryName.substring(0, directoryName.lastIndexOf(' '));
};

const ObsidianIllegalNameRegex = /[\*\"\/\\\<\>\:\|\?]/g;
const URLRegex = /(:\/\/)|(w{3})|(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/;
const correctMarkdownLinks = (content: string) => {
	//* [Link Text](Link Directory + uuid/And Page Name + uuid) => [[LinkText]]

	//TODO: Test all of these regex patterns and document exactly what they match to.
	//They can likely be minimized or combined in some way.
	const linkFullMatches = content.match(/(\[(.*?)\])(\((.*?)\))/gi);
	const linkTextMatches = content.match(/(\[(.*?)\])(\()/gi);
	const linkFloaterMatches = content.match(/([\S]*\.md(\))?)/gi);
	const linkNotionMatches = content.match(/([\S]*notion.so(\S*))/g);
	if (!linkFullMatches && !linkFloaterMatches && !linkNotionMatches) return { content: content, links: 0 };

	let totalLinks = 0;

	let out = content;
	if (linkFullMatches && linkTextMatches) {
		totalLinks += linkFullMatches.length;
		for (let i = 0; i < linkFullMatches.length; i++) {
			if (URLRegex.test(linkFullMatches[i])) {
				continue;
			}
			let linkText = linkTextMatches[i].substring(1, linkTextMatches[i].length - 2);
			if (linkText.includes('.png')) {
				linkText = convertPNGPath(linkText);
			} else {
				linkText = linkText.replace(ObsidianIllegalNameRegex, ' ');
			}
			out = out.replace(linkFullMatches[i], `[[${linkText}]]`);
		}
	}

	//! Convert free-floating relativePaths and Notion.so links
	if (linkFloaterMatches) {
		totalLinks += linkFullMatches ? linkFloaterMatches.length - linkFullMatches.length : linkFloaterMatches.length;
		out = out.replace(/([\S]*\.md(\))?)/gi, convertRelativePath);
	}

	if (linkNotionMatches) {
		out = out.replace(/([\S]*notion.so(\S*))/g, convertNotionLinks);
		totalLinks += linkNotionMatches.length;
	}

	return {
		content: out,
		links: totalLinks,
	};
};

const convertPNGPath = (path: string) => {
	let imageTitle = path
		.substring(path.lastIndexOf('/') + 1)
		.split('%20')
		.join(' ');

	path = convertRelativePath(path.substring(0, path.lastIndexOf('/')));
	path = path.substring(2, path.length - 2);

	return `${path}/${imageTitle}`;
};

const convertNotionLinks = (match: string) => {
	return `[[${match
		.substring(match.lastIndexOf('/') + 1)
		.split('-')
		.slice(0, -1)
		.join(' ')}]]`;
};

const convertRelativePath = (path: string) => {
	return `[[${path.split('/').pop().split('%20').slice(0, -1).join(' ')}]]`;
};

const correctCSVLinks = (content: string) => {
	//* ../Relative%20Path/To/File%20Name.md => [[File Name]]
	let lines = content.split('\n');
	let links = 0;
	for (let x = 0; x < lines.length; x++) {
		let line = lines[x];
		let cells = line.split(',');

		for (let y = 0; y < cells.length; y++) {
			let cell = cells[y];
			if (cell.includes('.md')) {
				cells[y] = convertRelativePath(cell);
				links++;
			}
		}
		lines[x] = cells.join(',');
	}
	return { content: lines.join('\n'), links: links };
};

const convertCSVToMarkdown = (content: string) => {
	//TODO clean up parameters
	const csvCommaReplace = (match: string, p1: string, p2: string, p3: string, offset: string, string: string) => {
		return `${p1}|${p3}`;
	};

	let fix = content.replace(/(\S)(\,)((\S)|(\n)|($))/g, csvCommaReplace).split('\n');
	const headersplit = '-|'.repeat(fix[0].split('').filter((char) => char === '|').length + 1);
	fix.splice(1, 0, headersplit);
	return fix.join('\n');
};

const fixNotionExport = function (path: string) {
	let directories: string[] = [];
	let files: string[] = [];
	let markdownLinks = 0;
	let csvLinks = 0;

	let currentDirectory = fs.readdirSync(path, { withFileTypes: true });

	for (let i = 0; i < currentDirectory.length; i++) {
		let currentPath = npath.format({
			dir: path,
			base: currentDirectory[i].name,
		});
		if (currentDirectory[i].isDirectory()) directories.push(currentPath);
		if (currentDirectory[i].isFile()) files.push(currentPath);
	}

	for (let i = 0; i < files.length; i++) {
		let file = files[i];
		if (!file.includes('.png')) {
			let trunc = truncateFileName(file);
			fs.renameSync(file, trunc);
			file = trunc;
			files[i] = trunc;
		}

		//Fix Markdown Links
		if (file.substring(file.indexOf('.')) === '.md') {
			const correctedFileContents = correctMarkdownLinks(fs.readFileSync(file, 'utf8'));
			if (correctedFileContents.links) markdownLinks += correctedFileContents.links;
			fs.writeFileSync(file, correctedFileContents.content, 'utf8');
		} else if (file.substring(file.indexOf('.')) === '.csv') {
			const correctedFileContents = correctCSVLinks(fs.readFileSync(file, 'utf8'));
			const csvConverted = convertCSVToMarkdown(correctedFileContents.content);
			if (correctedFileContents.links) csvLinks += correctedFileContents.links;
			fs.writeFileSync(file, correctedFileContents.content, 'utf8');
			fs.writeFileSync(file.substring(0, file.indexOf('.')) + '.md', csvConverted, 'utf8');
		}
	}
	for (let i = 0; i < directories.length; i++) {
		let dir = directories[i];
		fs.renameSync(dir, truncateDirName(dir));
		directories[i] = truncateDirName(dir);
	}

	directories.forEach((dir) => {
		const reading = fixNotionExport(dir);
		directories = directories.concat(reading.directories);
		files = files.concat(reading.files);
		markdownLinks += reading.markdownLinks;
		csvLinks += reading.csvLinks;
	});

	return {
		directories: directories,
		files: files,
		markdownLinks: markdownLinks,
		csvLinks: csvLinks,
	};
};
