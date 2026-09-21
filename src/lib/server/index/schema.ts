/**
 * The index schema, and the only place SQL DDL lives.
 *
 * Everything here is derived from markdown and can be thrown away: deleting
 * the database file and rebuilding is always correct. Nothing is stored that
 * the vault does not already say.
 */

export const SCHEMA_VERSION = 2;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS notes (
  path        TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  hash        TEXT NOT NULL,
  mtime_ms    INTEGER NOT NULL,
  bytes       INTEGER NOT NULL,
  frontmatter TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS tasks (
  path      TEXT NOT NULL,
  line      INTEGER NOT NULL,
  block_end INTEGER NOT NULL,
  status    TEXT NOT NULL,
  start_min INTEGER,
  end_min   INTEGER,
  text      TEXT NOT NULL,
  quadrant  INTEGER,
  fenced    INTEGER NOT NULL DEFAULT 0,
  raw       TEXT NOT NULL,
  task_id    TEXT,
  blocked_by TEXT NOT NULL DEFAULT '',
  due        TEXT,
  PRIMARY KEY (path, line)
);
CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS tasks_quadrant ON tasks(quadrant);
CREATE INDEX IF NOT EXISTS tasks_id ON tasks(task_id);
CREATE INDEX IF NOT EXISTS tasks_due ON tasks(due);

-- Tags written on a task line, kept apart from the note's tags so a board can
-- ask for the tasks carrying a workspace tag without loading their notes.
CREATE TABLE IF NOT EXISTS task_tags (
  path TEXT NOT NULL,
  line INTEGER NOT NULL,
  tag  TEXT NOT NULL,
  PRIMARY KEY (path, line, tag)
);
CREATE INDEX IF NOT EXISTS task_tags_tag ON task_tags(tag);

CREATE TABLE IF NOT EXISTS links (
  path   TEXT NOT NULL,
  target TEXT NOT NULL,
  line   INTEGER NOT NULL,
  embed  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS links_target ON links(target);
CREATE INDEX IF NOT EXISTS links_path ON links(path);

CREATE TABLE IF NOT EXISTS tags (
  path TEXT NOT NULL,
  tag  TEXT NOT NULL,
  PRIMARY KEY (path, tag)
);
CREATE INDEX IF NOT EXISTS tags_tag ON tags(tag);

CREATE TABLE IF NOT EXISTS headings (
  path  TEXT NOT NULL,
  level INTEGER NOT NULL,
  text  TEXT NOT NULL,
  line  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS headings_path ON headings(path);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  path UNINDEXED, title, body, tokenize = 'porter unicode61'
);

-- Files the parser could not fully understand, surfaced as index health
-- rather than swallowed.
CREATE TABLE IF NOT EXISTS problems (
  path    TEXT PRIMARY KEY,
  message TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
