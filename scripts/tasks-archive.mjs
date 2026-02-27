import { mkdir, readdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const tasksDir = path.resolve(repoRoot, 'tasks');
const activeDir = path.resolve(tasksDir, 'active');
const archiveDir = path.resolve(tasksDir, 'archive');

const taskFilePattern = /^(\d{8})-(.+)-(todo|lessons)\.md$/;
const uncheckedTodoPattern = /^\s*-\s*\[ \]/m;

function parseTaskFilename(filename) {
  const match = filename.match(taskFilePattern);
  if (!match) {
    return null;
  }

  return {
    date: match[1],
    slug: match[2],
    kind: match[3],
    key: `${match[1]}-${match[2]}`,
  };
}

async function listTaskFilesFlat(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const parsed = parseTaskFilename(entry.name);
        if (!parsed) {
          return null;
        }
        return {
          absolutePath: path.resolve(dir, entry.name),
          filename: entry.name,
          parsed,
        };
      })
      .filter((value) => value !== null);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function toArchiveDirectory(date) {
  const year = date.slice(0, 4);
  const month = date.slice(4, 6);
  return path.resolve(archiveDir, year, month);
}

const [rootFiles, activeFiles] = await Promise.all([
  listTaskFilesFlat(tasksDir),
  listTaskFilesFlat(activeDir),
]);

const allFiles = [...rootFiles, ...activeFiles];
const taskMap = new Map();

for (const file of allFiles) {
  const existing = taskMap.get(file.parsed.key);
  if (existing) {
    existing.files.push(file);
  } else {
    taskMap.set(file.parsed.key, {
      key: file.parsed.key,
      date: file.parsed.date,
      slug: file.parsed.slug,
      files: [file],
    });
  }
}

let movedToActive = 0;
let movedToArchive = 0;
let unchanged = 0;

await mkdir(activeDir, { recursive: true });
await mkdir(archiveDir, { recursive: true });

for (const task of taskMap.values()) {
  const todoFile = task.files.find((file) => file.parsed.kind === 'todo');

  let shouldStayActive = true;
  if (todoFile) {
    const todoText = await readFile(todoFile.absolutePath, 'utf8');
    shouldStayActive = uncheckedTodoPattern.test(todoText);
  }

  const destinationDirectory = shouldStayActive
    ? activeDir
    : toArchiveDirectory(task.date);

  await mkdir(destinationDirectory, { recursive: true });

  for (const file of task.files) {
    const destinationPath = path.resolve(destinationDirectory, file.filename);
    if (destinationPath === file.absolutePath) {
      unchanged += 1;
      continue;
    }

    await rename(file.absolutePath, destinationPath);
    if (shouldStayActive) {
      movedToActive += 1;
    } else {
      movedToArchive += 1;
    }
  }
}

console.log(`[tasks:archive] Processed ${taskMap.size} tasks.`);
console.log(
  `[tasks:archive] Moved ${movedToActive} files to active and ${movedToArchive} files to archive.`,
);
console.log(`[tasks:archive] Left ${unchanged} files in place.`);
