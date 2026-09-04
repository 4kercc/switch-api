/**
 * 管理员 JWT 鉴权与密码验证
 */
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import config from '../config/config.js';

export function generateToken(payload, expiresIn = '7d') {
  return jwt.sign(payload, config.admin.jwtSecret, { expiresIn });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, config.admin.jwtSecret);
  } catch (e) {
    return null;
  }
}

export function verifyPassword(password) {
  if (!password || !config.admin.password) return false;
  return password === config.admin.password;
}
