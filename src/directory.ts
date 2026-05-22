/**
 * Directory Management
 *
 * Manages the .skillgraph/ directory structure for SkillGraph data.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * SkillGraph directory name
 */
export const SKILLGRAPH_DIR = '.skillgraph';

/**
 * Get the .skillgraph directory path for a project
 */
export function getSkillGraphDir(projectRoot: string): string {
  return path.join(projectRoot, SKILLGRAPH_DIR);
}

/**
 * Check if a project has been initialized with SkillGraph
 * Requires both .skillgraph/ directory AND skillgraph.db to exist
 */
export function isInitialized(projectRoot: string): boolean {
  const skillgraphDir = getSkillGraphDir(projectRoot);
  if (!fs.existsSync(skillgraphDir) || !fs.statSync(skillgraphDir).isDirectory()) {
    return false;
  }
  // Must have skillgraph.db, not just .skillgraph folder
  const dbPath = path.join(skillgraphDir, 'skillgraph.db');
  return fs.existsSync(dbPath);
}

/**
 * Find the nearest parent directory containing .skillgraph/
 *
 * Walks up from the given path to find a SkillGraph-initialized project,
 * similar to how git finds .git/ directories.
 *
 * @param startPath - Directory to start searching from
 * @returns The project root containing .skillgraph/, or null if not found
 */
export function findNearestSkillGraphRoot(startPath: string): string | null {
  let current = path.resolve(startPath);
  const root = path.parse(current).root;

  while (current !== root) {
    if (isInitialized(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break; // Reached filesystem root
    current = parent;
  }

  // Check root as well
  if (isInitialized(current)) {
    return current;
  }

  return null;
}

/**
 * Create the .skillgraph directory structure
 * Note: Only throws if skillgraph.db already exists, not just if .skillgraph/ exists.
 */
export function createDirectory(projectRoot: string): void {
  const skillgraphDir = getSkillGraphDir(projectRoot);
  const dbPath = path.join(skillgraphDir, 'skillgraph.db');

  // Only throw if SkillGraph is actually initialized (db exists)
  // .skillgraph/ folder alone is fine
  if (fs.existsSync(dbPath)) {
    throw new Error(`SkillGraph already initialized in ${projectRoot}`);
  }

  // Create main directory (if it doesn't exist)
  fs.mkdirSync(skillgraphDir, { recursive: true });

  // Create .gitignore inside .skillgraph (if it doesn't exist)
  const gitignorePath = path.join(skillgraphDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    const gitignoreContent = `# SkillGraph data files
# These are local to each machine and should not be committed

# Database
*.db
*.db-wal
*.db-shm

# Cache
cache/

# Logs
*.log

# Hook markers
.dirty
`;

    fs.writeFileSync(gitignorePath, gitignoreContent, 'utf-8');
  }
}

/**
 * Remove the .skillgraph directory
 */
export function removeDirectory(projectRoot: string): void {
  const skillgraphDir = getSkillGraphDir(projectRoot);

  if (!fs.existsSync(skillgraphDir)) {
    return;
  }

  // Verify .skillgraph is a real directory, not a symlink pointing elsewhere
  const lstat = fs.lstatSync(skillgraphDir);
  if (lstat.isSymbolicLink()) {
    // Only remove the symlink itself, never follow it for recursive delete
    fs.unlinkSync(skillgraphDir);
    return;
  }

  if (!lstat.isDirectory()) {
    // Not a directory - remove the single file
    fs.unlinkSync(skillgraphDir);
    return;
  }

  // Recursively remove directory
  fs.rmSync(skillgraphDir, { recursive: true, force: true });
}

/**
 * Get all files in the .skillgraph directory
 */
export function listDirectoryContents(projectRoot: string): string[] {
  const skillgraphDir = getSkillGraphDir(projectRoot);

  if (!fs.existsSync(skillgraphDir)) {
    return [];
  }

  const files: string[] = [];

  function walkDir(dir: string, prefix: string = ''): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      // Skip symlinks to prevent following links outside .skillgraph
      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        walkDir(path.join(dir, entry.name), relativePath);
      } else {
        files.push(relativePath);
      }
    }
  }

  walkDir(skillgraphDir);
  return files;
}

/**
 * Get the total size of the .skillgraph directory in bytes
 */
export function getDirectorySize(projectRoot: string): number {
  const skillgraphDir = getSkillGraphDir(projectRoot);

  if (!fs.existsSync(skillgraphDir)) {
    return 0;
  }

  let totalSize = 0;

  function walkDir(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip symlinks to prevent following links outside .skillgraph
      if (entry.isSymbolicLink()) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else {
        const stats = fs.statSync(fullPath);
        totalSize += stats.size;
      }
    }
  }

  walkDir(skillgraphDir);
  return totalSize;
}

/**
 * Ensure a subdirectory exists within .skillgraph
 */
export function ensureSubdirectory(projectRoot: string, subdirName: string): string {
  if (subdirName.includes('..') || subdirName.includes(path.sep) || subdirName.includes('/')) {
    throw new Error(`Invalid subdirectory name: ${subdirName}`);
  }

  const subdirPath = path.join(getSkillGraphDir(projectRoot), subdirName);

  if (!fs.existsSync(subdirPath)) {
    fs.mkdirSync(subdirPath, { recursive: true });
  }

  return subdirPath;
}

/**
 * Check if the .skillgraph directory has valid structure
 */
export function validateDirectory(projectRoot: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const skillgraphDir = getSkillGraphDir(projectRoot);

  if (!fs.existsSync(skillgraphDir)) {
    errors.push('SkillGraph directory does not exist');
    return { valid: false, errors };
  }

  if (!fs.statSync(skillgraphDir).isDirectory()) {
    errors.push('.skillgraph exists but is not a directory');
    return { valid: false, errors };
  }

  // Auto-repair missing .gitignore (non-critical file)
  const gitignorePath = path.join(skillgraphDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    try {
      const gitignoreContent = `# SkillGraph data files\n# These are local to each machine and should not be committed\n\n# Database\n*.db\n*.db-wal\n*.db-shm\n\n# Cache\ncache/\n\n# Logs\n*.log\n\n# Hook markers\n.dirty\n`;
      fs.writeFileSync(gitignorePath, gitignoreContent, 'utf-8');
    } catch {
      // Non-fatal: warn but don't block
      errors.push('.gitignore missing in .skillgraph directory and could not be created');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
