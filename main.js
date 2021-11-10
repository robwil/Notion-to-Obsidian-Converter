const fs = require('fs');
const readline = require('readline');
const npath = require('path');

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});
let rootPath;
rl.question('Notion Export Path:\n', (path) => {
	const start = Date.now();
	rootPath = path.trim();
	const output = fixNotionExport(rootPath);
	const elapsed = Date.now() - start;

	console.log(
		`Fixed in ${elapsed}ms
${'-'.repeat(8)}
Directories: ${output.directories.length}
Files: ${output.files.length}
Images: ${output.images.length}
Markdown Links: ${output.markdownLinks}
CSV Links: ${output.csvLinks}`
	);

	rl.close();
});

const truncateFileName = (name) => {
	let bn = npath.basename(name);
	bn = bn.lastIndexOf(' ') > 0 ? bn.substring(0, bn.lastIndexOf(' ')) : bn;
	return npath.resolve(
		npath.format({
			dir: npath.dirname(name),
			base: bn + npath.extname(name),
		})
	);
};

const truncateDirName = (name) => {
	let bn = npath.basename(name);
	bn = bn.lastIndexOf(' ') > 0 ? bn.substring(0, bn.lastIndexOf(' ')) : bn;
	return npath.resolve(
		npath.format({
			dir: npath.dirname(name),
			base: bn,
		})
	);
};

const ObsidianIllegalNameRegex = /[\*\"\/\\\<\>\:\|\?]/g;
const URLRegex = /(:\/\/)|(w{3})|(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/;
const correctMarkdownLinks = (currentDirectory, content) => {
	//* [Link Text](Link Directory + uuid/And Page Name + uuid) => [[LinkText]]

	const linkFullMatches = content.match(/(\[(.*?)\])(\((.*)\))(\s*)/gi);
	const linkFloaterMatches = content.match(/([\S]*\.md(\))?)/gi);
	const linkNotionMatches = content.match(/([\S]*notion.so(\S*))/g);
	if (!linkFullMatches && !linkFloaterMatches && !linkNotionMatches)
		return { content: content, links: 0, foundImages: [] };

	let totalLinks = 0;
	const foundImages = new Set();

	let out = content;
	if (linkFullMatches) {
		totalLinks += linkFullMatches.length;
		for (let i = 0; i < linkFullMatches.length; i++) {
			if (URLRegex.test(linkFullMatches[i])) {
				continue;
			}
			const linkPieces = linkFullMatches[i].match(/(\[(.*?)\])(\((.*)\))(\s*)/);
			let linkText = linkPieces[2];
			if (isImagePath(linkText)) {
				// for images, we actually care about the link destination, not the link text
				linkText = linkPieces[4];
				const imageDetails = convertImagePath(currentDirectory, linkText);
				console.log({imageDetails});
				foundImages.add(imageDetails);
				linkText = imageDetails.imageLinkPath;
			} else {
				linkText = linkText.replace(ObsidianIllegalNameRegex, ' ');
			}
			const endWhitespace = linkPieces[5];
			out = out.replace(linkFullMatches[i], `[[${linkText}]]${endWhitespace}`);
		}
	}

	//! Convert free-floating relativePaths and Notion.so links
	if (linkFloaterMatches) {
		totalLinks += linkFullMatches
			? linkFloaterMatches.length - linkFullMatches.length
			: linkFloaterMatches.length;
		out = out.replace(/([\S]*\.md(\))?)/gi, convertRelativePath);
	}

	if (linkNotionMatches) {
		out = out.replace(/([\S]*notion.so(\S*))/g, convertNotionLinks);
		totalLinks += linkNotionMatches.length;
	}
	return {
		content: out,
		links: totalLinks,
		foundImages: [...foundImages.values()],
	};
};

const isImagePath = (path) => {
	return path.includes('.png') 
		|| path.includes(".gif") 
		|| path.includes(".jpg") 
		|| path.includes(".jpeg") 
		|| path.includes(".svg") 
		|| path.includes(".webp");
}

const convertImagePath = (currentDirectory, path) => {
	// The image path coming from the Notion MD files will have the UUID appended, which we must clean up
	let imageTitle = path
		.substring(path.lastIndexOf('/') + 1)
		.split('%20')
		.join(' ');
	path = convertRelativePath(path.substring(0, path.lastIndexOf('/')));
	path = path.substring(2, path.length - 2);

	// We will later move the images to dedicated /Images folder to keep them out of the way from the notes folders
	// This calculates the current path, new path, and resolves the absolute image link path to put in the markdown.
	const relativePath = `${path}/${imageTitle}`;
	const currentDirectoryFromRoot = npath.relative(rootPath, currentDirectory);
	const fullRelativePath = `${currentDirectoryFromRoot}/${relativePath}`;
	const imageLinkPath = `/Images/${fullRelativePath}`;
	return {
		imageLinkPath,
		originalFilePath: `${rootPath}/${fullRelativePath}`,
		newFilePath:  `${rootPath}${imageLinkPath}`,
	};
};

const convertNotionLinks = (match, p1, p2, p3) => {
	return `[[${match
		.substring(match.lastIndexOf('/') + 1)
		.split('-')
		.slice(0, -1)
		.join(' ')}]]`;
};

const convertRelativePath = (path) => {
	return `[[${path.split('/').pop().split('%20').slice(0, -1).join(' ')}]]`;
};

const correctCSVLinks = (content) => {
	//* ../Relative%20Path/To/File%20Name.md => [[File Name]]
	let lines = content.split('\n');
	let links = 0;
	for (let x = 0; x < lines.length; x++) {
		let line = lines[x];
		cells = line.split(',');

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

const convertCSVToMarkdown = (content) => {
	const csvCommaReplace = (match, p1, p2, p3, offset, string) => {
		return `${p1}|${p3}`;
	};

	let fix = content
		.replace(/(\S)(\,)((\S)|(\n)|($))/g, csvCommaReplace)
		.split('\n');
	const headersplit = '-|'.repeat(
		fix[0].split('').filter((char) => char === '|').length + 1
	);
	fix.splice(1, 0, headersplit);
	return fix.join('\n');
};

const fixNotionExport = function (path) {
	let directories = [];
	let files = [];
	let markdownLinks = 0;
	let csvLinks = 0;
	let images = [];

	console.log(`Fixing dir ${path}`);
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
		if (!isImagePath(file)) {
			let trunc = truncateFileName(file);
			fs.renameSync(file, trunc);
			file = trunc;
			files[i] = trunc;
		}

		//Fix Markdown Links
		if (npath.extname(file) === '.md') {
			const correctedFileContents = correctMarkdownLinks(
				path,
				fs.readFileSync(file, 'utf8')
			);
			if (correctedFileContents.links)
				markdownLinks += correctedFileContents.links;
			fs.writeFileSync(file, correctedFileContents.content, 'utf8');
			images.push(...(correctedFileContents.foundImages));
		} else if (npath.extname(file) === '.csv') {
			const correctedFileContents = correctCSVLinks(
				fs.readFileSync(file, 'utf8')
			);
			const csvConverted = convertCSVToMarkdown(
				correctedFileContents.content
			);
			if (correctedFileContents.links)
				csvLinks += correctedFileContents.links;
			fs.writeFileSync(file, correctedFileContents.content, 'utf8');
			fs.writeFileSync(
				npath.resolve(
					npath.format({
						dir: npath.dirname(file),
						base: npath.basename(file, `.csv`) + '.md',
					})
				),
				csvConverted,
				'utf8'
			);
		}
	}
	for (let i = 0; i < directories.length; i++) {
		let dir = directories[i];
		let dest = truncateDirName(dir);
		while (fs.existsSync(dest)) {
			dest = `${dest} - ${Math.random().toString(36).slice(2)}`;
		}
		fs.renameSync(dir, dest);
		directories[i] = dest;
	}

	// move all images to a central /Images/ folder.
	// the details of current and new filename were already calculated and passed to us as imageDetails.
	images.forEach((imageDetails) => {
		const newFileDirectory = npath.dirname(imageDetails.newFilePath);
		if (!fs.existsSync(newFileDirectory)){
			fs.mkdirSync(newFileDirectory, { recursive: true });
		}
		fs.renameSync(imageDetails.originalFilePath, imageDetails.newFilePath);
	});

	// after all images are moved, we need to delete their original directories which should now be empty
	images.forEach((imageDetails) => {
		const currentFileDirectory = npath.dirname(imageDetails.originalFilePath);
		if (fs.existsSync(currentFileDirectory)) {
			fs.rmdirSync(currentFileDirectory);
			// also remove directory from recursion that will happen below
			directories = directories.filter(directory => directory != currentFileDirectory);
		}
	});

	directories.forEach((dir) => {
		const stats = fixNotionExport(dir);
		directories = directories.concat(stats.directories);
		files = files.concat(stats.files);
		markdownLinks += stats.markdownLinks;
		csvLinks += stats.csvLinks;
		images = images.concat(stats.images);
	});

	return {
		directories: directories,
		files: files,
		markdownLinks: markdownLinks,
		csvLinks: csvLinks,
		images,
	};
};
