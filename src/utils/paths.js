/**
 * 路径管理工具
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getProjectRoot() {
  return path.join(__dirname, '../..');
}

export function getDataDir() {
  const dataDir = path.join(getProjectRoot(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

export function getPublicDir() {
  return path.join(getProjectRoot(), 'public');
}

export function getConfigPaths() {
  const root = getProjectRoot();
  return {
    envPath: path.join(root, '.env'),
    configJsonPath: path.join(root, 'config.json'),
    configJsonExamplePath: path.join(root, 'config.json.example'),
    examplePath: path.join(root, '.env.example')
  };
}
