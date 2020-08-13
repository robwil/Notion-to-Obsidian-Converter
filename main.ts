import * as fs from 'fs';
import * as readline from 'readline';
import * as npath from 'path';
import { ObsidianIllegalNameRegex, URLRegex, linkFullRegex, linkTextRegex, linkFloaterRegex, linkNotionRegex } from './regex';

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

const correctMarkdownLinks = (content: string) => {
	//* [Link Text](Link Directory + uuid/And Page Name + uuid) => [[LinkText]]

	//TODO: Test all of these regex patterns and document exactly what they match to.
	//They can likely be minimized or combined in some way.
	const linkFullMatches = content.match(linkFullRegex); //=> [Link Text](Link Directory + uuid/And Page Name + uuid)
	const linkTextMatches = content.match(linkTextRegex); //=> [Link Text](
	const linkFloaterMatches = content.match(linkFloaterRegex);// => Text](Link Directory + uuid/And Page Name + uuid)
	const linkNotionMatches = content.match(linkNotionRegex); // => `https://www.notion.so/The-Page-Title-2d41ab7b61d14cec885357ab17d48536`
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

	//! Convert free-floating relativePaths
	if (linkFloaterMatches) {
		totalLinks += linkFullMatches ? linkFloaterMatches.length - linkFullMatches.length : linkFloaterMatches.length;
		//* This often won't run because the earlier linkFullMatches && linkTextMatches block will take care of most of the links
		out = out.replace(linkFloaterRegex, convertRelativePath);
	}

	if (linkNotionMatches) {
		out = out.replace(linkNotionRegex, convertNotionLinks);
		totalLinks += linkNotionMatches.length;
	}

	return {
		content: out,
		links: totalLinks,
	};
};

//`![Page%20Title%20c5ae5f01ba5d4fb9a94d13d99397100c/Image%20Name.png](Page%20Title%20c5ae5f01ba5d4fb9a94d13d99397100c/Image%20Name.png)` => `![Page Title/Image Name.png]`
const convertPNGPath = (path: string) => {
	let imageTitle = path
		.substring(path.lastIndexOf('/') + 1)
		.split('%20')
		.join(' ');

	path = convertRelativePath(path.substring(0, path.lastIndexOf('/')));
	path = path.substring(2, path.length - 2);

	return `${path}/${imageTitle}`;
};

//`https://www.notion.so/The-Page-Title-2d41ab7b61d14cec885357ab17d48536` => `[[The Page Title]]`
const convertNotionLinks = (match: string) => {
	return `[[${match
		.substring(match.lastIndexOf('/') + 1)
		.split('-')
		.slice(0, -1)
		.join(' ')}]]`;
};

//Takes the last section in the path (removing the preceeding directorie) then removes the uuid at the end.
//`The%20Page%20Title%200637657f8a854e05a142871cce86ff701` => `[[Page Title]]
const convertRelativePath = (path: string) => {
	return `[[${(path.split('/').pop() || path).split('%20').slice(0, -1).join(' ')}]]`;
};

//Goes through each link inside of CSVs and converts them
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

const getDirectoryContent = (path: string) => {
	const directories: string[] = [];
	const files: string[] = [];
	const currentDirectory = fs.readdirSync(path, { withFileTypes: true });

	for (let i = 0; i < currentDirectory.length; i++) {
		let currentPath = npath.format({
			dir: path,
			base: currentDirectory[i].name,
		});
		if (currentDirectory[i].isDirectory()) directories.push(currentPath);
		if (currentDirectory[i].isFile()) files.push(currentPath);
	}

	return { directories: directories, files: files };
}

const fixNotionExport = (path: string) => {
	let markdownLinks = 0;
	let csvLinks = 0;

	const directoryContent = getDirectoryContent(path);
	let directories: string[] = directoryContent.directories;
	let files: string[] = directoryContent.files;

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
