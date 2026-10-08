import { newCredential, newServer, relativeDate } from './server-credentials-contract.ts';
import type { CredentialRecord, ServerRecord } from './server-credentials-contract.ts';

// Virtual UI-preview records only. Normal application state starts empty and loads from Rust.
export function demoCredentials(): CredentialRecord[] {
  return [
    { ...newCredential(), id: 'studio-login', name: '云服务控制台', category: '服务器', username: 'studio@example.com', password: 'Demo-only-2026!', website: 'https://cloud.example.com', notes: '演示账号，用于管理云主机和账单。' },
    { ...newCredential(), id: 'render-key', name: '渲染节点 SSH 密钥', kind: 'ssh', category: '服务器', username: 'render', publicFile: 'render-demo.pub', privateFile: 'render-demo.pem', notes: '虚构文件名，没有真实密钥内容。' },
    { ...newCredential(), id: 'design-login', name: '素材网站', category: '网站', username: 'artist@example.com', password: 'Example-assets-26', website: 'https://assets.example.com' },
    { ...newCredential(), id: 'software-login', name: '制作软件账号', category: '软件', username: 'creator@example.com', password: 'Example-studio-26' },
  ];
}
export function demoServers(today: string): ServerRecord[] {
  return [
    { ...newServer(), id: 'render-node', name: '渲染节点 · 新加坡', provider: '示例云 A', address: '192.0.2.18', region: '新加坡', configuration: '8 核 / 32 GB / 200 GB', purpose: '远程渲染与素材处理', purchased: relativeDate(today, -358), expires: relativeDate(today, 7), price: '1680', credentialId: 'render-key', loginUsername: 'render', loginPassword: 'Demo-render-only-26' },
    { ...newServer(), id: 'portfolio', name: '个人作品站', provider: '示例云 B', address: '198.51.100.24', region: '香港', configuration: '2 核 / 4 GB / 60 GB', purpose: '作品集展示', purchased: relativeDate(today, -340), expires: relativeDate(today, 25), price: '360', credentialId: 'studio-login' },
    { ...newServer(), id: 'archive-node', name: '素材中转站', provider: '示例云 A', address: '203.0.113.42', region: '东京', configuration: '4 核 / 8 GB / 100 GB', purpose: '临时文件中转', purchased: relativeDate(today, -33), expires: relativeDate(today, -3), price: '48', cycle: '月付' },
    { ...newServer(), id: 'development', name: '开发实验机', provider: '示例云 C', address: '192.0.2.66', region: '上海', configuration: '4 核 / 8 GB / 80 GB', purpose: '个人项目开发', purchased: relativeDate(today, -270), expires: relativeDate(today, 95), price: '680' },
  ];
}
