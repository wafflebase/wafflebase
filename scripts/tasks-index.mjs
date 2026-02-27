import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const tasksDir = path.resolve(repoRoot, 'tasks');
const activeDir = path.resolve(tasksDir, 'active');
const archiveDir = path.resolve(tasksDir, 'archive');

const taskFilePattern = /^(\d{8})-(.+)-(todo|lessons)\.md$/;

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

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

function formatDate(date) {
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

function taskLabel(task) {
  const slug = task.slug.replace(/-/g, ' ');
  return `${slug} (${formatDate(task.date)})`;
}

function compareTasksDesc(a, b) {
  if (a.date !== b.date) {
    return b.date.localeCompare(a.date);
  }
  return a.slug.localeCompare(b.slug);
}

async function walkFiles(dir, rootDir) {
  const results = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.resolve(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await walkFiles(absolutePath, rootDir);
      results.push(...nested);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    results.push({
      absolutePath,
      relativePath: toPosix(path.relative(rootDir, absolutePath)),
      filename: entry.name,
    });
  }

  return results;
}

async function collectTasks(baseDir, rootDir) {
  try {
    const files = await walkFiles(baseDir, rootDir);
    const map = new Map();

    for (const file of files) {
      const parsed = parseTaskFilename(file.filename);
      if (!parsed) {
        continue;
      }

      const existing = map.get(parsed.key);
      if (existing) {
        if (parsed.kind === 'todo') {
          existing.todoPath = file.relativePath;
        } else {
          existing.lessonsPath = file.relativePath;
        }
        continue;
      }

      map.set(parsed.key, {
        key: parsed.key,
        date: parsed.date,
        slug: parsed.slug,
        todoPath: parsed.kind === 'todo' ? file.relativePath : undefined,
        lessonsPath: parsed.kind === 'lessons' ? file.relativePath : undefined,
      });
    }

    return [...map.values()].sort(compareTasksDesc);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function renderTaskRows(tasks, linkPrefix = './') {
  if (tasks.length === 0) {
    return ['| _None_ | - | - |'];
  }

  return tasks.map((task) => {
    const todo = task.todoPath
      ? `[${path.basename(task.todoPath)}](${linkPrefix}${toPosix(task.todoPath)})`
      : '-';
    const lessons = task.lessonsPath
      ? `[${path.basename(task.lessonsPath)}](${linkPrefix}${toPosix(task.lessonsPath)})`
      : '-';
    return `| ${taskLabel(task)} | ${todo} | ${lessons} |`;
  });
}

function renderArchiveSections(tasks) {
  if (tasks.length === 0) {
    return ['No archived tasks yet.'];
  }

  const grouped = new Map();
  for (const task of tasks) {
    const key = `${task.date.slice(0, 4)}/${task.date.slice(4, 6)}`;
    const group = grouped.get(key);
    if (group) {
      group.push(task);
    } else {
      grouped.set(key, [task]);
    }
  }

  const sections = [];
  const monthKeys = [...grouped.keys()].sort((a, b) => b.localeCompare(a));

  for (const monthKey of monthKeys) {
    const monthTasks = grouped.get(monthKey) || [];
    sections.push(`## ${monthKey} (${monthTasks.length} tasks)`);
    sections.push('');
    sections.push('| Task | Todo | Lessons |');
    sections.push('|---|---|---|');
    sections.push(...renderTaskRows(monthTasks, './'));
    sections.push('');
  }

  return sections;
}

await mkdir(activeDir, { recursive: true });
await mkdir(archiveDir, { recursive: true });

const activeTasks = await collectTasks(activeDir, tasksDir);
const archiveTasks = await collectTasks(archiveDir, archiveDir);

const tasksReadmeLines = [
  '# Tasks Index',
  '',
  'Track task-specific plan/review and lessons files using the active/archive layout.',
  '',
  '## Layout',
  '',
  '- Active tasks: `tasks/active/`',
  '- Archived tasks: `tasks/archive/YYYY/MM/`',
  '- Regenerate indexes: `pnpm tasks:index`',
  '- Archive completed tasks: `pnpm tasks:archive`',
  '',
  '## Naming',
  '',
  '- Todo/review: `YYYYMMDD-<slug>-todo.md`',
  '- Lessons: `YYYYMMDD-<slug>-lessons.md`',
  '',
  '## Active Tasks',
  '',
  '| Task | Todo | Lessons |',
  '|---|---|---|',
  ...renderTaskRows(activeTasks),
  '',
  '## Archive',
  '',
  `- Archived task count: ${archiveTasks.length}`,
  '- Archive index: [archive/README.md](./archive/README.md)',
  '',
  activeTasks.length > 0
    ? `Latest active task: ${taskLabel(activeTasks[0])}`
    : 'Latest active task: none',
];

const archiveReadmeLines = [
  '# Tasks Archive',
  '',
  'Completed task records, grouped by year/month.',
  '',
  '- Regenerate indexes: `pnpm tasks:index`',
  '- Move completed tasks from root/active into archive: `pnpm tasks:archive`',
  '- Back to tasks index: [../README.md](../README.md)',
  '',
  `Total archived tasks: ${archiveTasks.length}`,
  '',
  ...renderArchiveSections(archiveTasks),
];

await writeFile(path.resolve(tasksDir, 'README.md'), `${tasksReadmeLines.join('\n')}\n`, 'utf8');
await writeFile(
  path.resolve(archiveDir, 'README.md'),
  `${archiveReadmeLines.join('\n')}\n`,
  'utf8',
);

console.log(`[tasks:index] Wrote tasks/README.md (${activeTasks.length} active tasks).`);
console.log(`[tasks:index] Wrote tasks/archive/README.md (${archiveTasks.length} archived tasks).`);
