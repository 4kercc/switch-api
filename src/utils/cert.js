/**
 * 证书与 HTTPS 证书管理模块
 */
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getDataDir } from './paths.js';
import logger from './logger.js';

const execAsync = promisify(exec);

export function getCertPaths() {
  const dataDir = getDataDir();
  return {
    certPath: path.join(dataDir, 'server.crt'),
    keyPath: path.join(dataDir, 'server.key')
  };
}

export function certsExist() {
  const { certPath, keyPath } = getCertPaths();
  return fs.existsSync(certPath) && fs.existsSync(keyPath);
}

export function generateSelfSignedCert(domain = '127.0.0.1') {
  const { certPath, keyPath } = getCertPaths();
  if (certsExist()) return;

  try {
    const cmd = `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 3650 -nodes -subj "/CN=${domain}"`;
    exec(cmd, (err) => {
      if (err) {
        logger.warn('生成自签名证书失败 (如未安装 openssl):', err.message);
      } else {
        logger.info(`✓ 已生成自签名 SSL 证书 (CN=${domain})`);
      }
    });
  } catch (e) {
    logger.warn('执行 openssl 异常:', e.message);
  }
}

export async function issueAcmeCert(domain) {
  if (!domain) throw new Error('域名不能为空');
  const { certPath, keyPath } = getCertPaths();
  const cmd = `~/.acme.sh/acme.sh --issue -d ${domain} --standalone --force && ~/.acme.sh/acme.sh --install-cert -d ${domain} --key-file "${keyPath}" --fullchain-file "${certPath}"`;
  logger.info(`正在通过 acme.sh 签发证书: ${domain}...`);
  await execAsync(cmd);
  logger.info(`✓ 证书签发安装成功: ${domain}`);
  return true;
}

export function getCertificateInfo() {
  const { certPath } = getCertPaths();
  if (!fs.existsSync(certPath)) {
    return { exists: false, type: 'none', domain: null, daysRemaining: 0 };
  }
  return {
    exists: true,
    type: 'valid',
    certPath
  };
}
